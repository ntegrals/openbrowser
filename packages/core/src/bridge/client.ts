import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { CustomCommandSpec } from '../commands/types.js';
import { createLogger } from '../logging.js';

const logger = createLogger('mcp-client');

// ── Types ──

export interface BridgeClientOptions {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	/** Timeout per JSON-RPC request in ms (default: 30_000) */
	requestTimeoutMs?: number;
	/** Maximum reconnection attempts (default: 5) */
	maxReconnectAttempts?: number;
	/** Initial reconnection delay in ms, doubles each attempt (default: 1000) */
	reconnectDelayMs?: number;
	/** Interval between health checks in ms (0 to disable, default: 0) */
	healthCheckIntervalMs?: number;
}

export interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	method: string;
}

export interface BridgeClientEvents {
	stateChange: [state: MCPConnectionState, previousState: MCPConnectionState];
	error: [error: Error];
	notification: [method: string, params: Record<string, unknown> | undefined];
}

/**
 * MCP client that connects to external MCP servers and converts their tools
 * into custom browser actions.
 *
 * Features:
 * - Reconnection with exponential backoff
 * - Per-call request timeout
 * - Concurrent request multiplexing (multiple in-flight requests)
 * - Tool list caching with invalidation
 * - Health check / ping
 * - Event emitter for connection state changes
 * - Graceful shutdown with pending request drain
 */
export class BridgeClient extends EventEmitter<BridgeClientEvents> {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pendingRequests = new Map<string | number, PendingRequest>();
	private options: BridgeClientOptions;
	private buffer = '';

	// ── Connection state ──
	private _state: MCPConnectionState = 'disconnected';
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Tool caching ──
	private cachedTools: MCPTool[] | null = null;
	private toolsCacheTimestamp = 0;

	// ── Health check ──
	private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

	// ── Config ──
	private readonly requestTimeoutMs: number;
	private readonly maxReconnectAttempts: number;
	private readonly reconnectDelayMs: number;
	private readonly healthCheckIntervalMs: number;

	constructor(options: BridgeClientOptions) {
		super();
		this.options = options;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
		this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 0;
	}

	// ── Public accessors ──

	get state(): MCPConnectionState {
		return this._state;
	}

	get isConnected(): boolean {
		return this._state === 'connected';
	}

	// ── Connection lifecycle ──

	async connect(): Promise<void> {
		if (this._state === 'connected') {
			logger.debug('Already connected, skipping connect()');
			return;
		}

		this.setState('connecting');
		await this.spawnProcess();
		await this.initialize();
		this.setState('connected');
		this.reconnectAttempts = 0;

		// Warm the tool cache
		await this.listTools();

		// Start health checks if configured
		this.startHealthChecks();

		logger.info(`Connected to MCP server: ${this.options.command}`);
	}

	private async spawnProcess(): Promise<void> {
		this.process = spawn(this.options.command, this.options.args ?? [], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { ...process.env, ...this.options.env },
		});

		this.process.stdout?.setEncoding('utf-8');
		this.process.stdout?.on('data', (data: string) => {
			this.buffer += data;
			this.processBuffer();
		});

		this.process.stderr?.on('data', (data: Buffer) => {
			logger.warn(`[MCP stderr] ${data.toString().trimEnd()}`);
		});

		this.process.on('close', (code: number | null) => {
			logger.info(`MCP server process exited with code ${code}`);
			this.handleProcessClose();
		});

		this.process.on('error', (error: Error) => {
			logger.error(`MCP server process error: ${error.message}`);
			this.emit('error', error);
			this.handleProcessClose();
		});
	}

	private async initialize(): Promise<void> {
		await this.send('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'open-browser', version: '0.1.0' },
		});

		// Send initialized notification (no id, no response expected)
		this.sendNotification('notifications/initialized');
	}

	// ── State management ──

	private setState(newState: MCPConnectionState): void {
		const previousState = this._state;
		if (previousState === newState) return;

		this._state = newState;
		logger.debug(`Connection state: ${previousState} -> ${newState}`);
		this.emit('stateChange', newState, previousState);
	}

	// ── Reconnection ──

	private handleProcessClose(): void {
		const wasPreviouslyConnected = this._state === 'connected';

		// Reject all pending requests
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error('MCP server disconnected'));
		}
		this.pendingRequests.clear();
		this.process = null;
		this.buffer = '';

		if (wasPreviouslyConnected) {
			this.attemptReconnect();
		} else {
			this.setState('disconnected');
		}
	}

	private attemptReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
			this.setState('disconnected');
			this.emit('error', new Error('MCP server reconnection failed after all attempts'));
