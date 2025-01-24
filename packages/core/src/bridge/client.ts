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
