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
			return;
		}

		this.setState('reconnecting');
		this.reconnectAttempts++;

		const delay = this.reconnectDelayMs * 2 ** (this.reconnectAttempts - 1);
		logger.info(
			`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
		);

		this.reconnectTimer = setTimeout(async () => {
			this.reconnectTimer = null;
			try {
				await this.spawnProcess();
				await this.initialize();
				this.setState('connected');
				this.reconnectAttempts = 0;

				// Invalidate tool cache on reconnect -- server may have changed
				this.invalidateToolCache();
				await this.listTools();

				this.startHealthChecks();
				logger.info('Reconnected to MCP server');
			} catch (error) {
				logger.warn(
					`Reconnect attempt ${this.reconnectAttempts} failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				this.attemptReconnect();
			}
		}, delay);
	}

	// ── Tool caching ──

	async listTools(): Promise<MCPTool[]> {
		if (this.cachedTools) {
			return this.cachedTools;
		}

		const result = (await this.send('tools/list', {})) as { tools: MCPTool[] };
		this.cachedTools = result.tools ?? [];
		this.toolsCacheTimestamp = Date.now();

		logger.debug(`Cached ${this.cachedTools.length} tools from MCP server`);
		return this.cachedTools;
	}

	/** Get cached tools synchronously. Returns empty array if cache is cold. */
	getTools(): MCPTool[] {
		return this.cachedTools ?? [];
	}

	/** Force-invalidate the tool cache. Next listTools() call will re-fetch. */
	invalidateToolCache(): void {
		this.cachedTools = null;
		this.toolsCacheTimestamp = 0;
	}

	/** Returns when the tool cache was last populated (epoch ms), or 0 if empty. */
	get toolsCacheAge(): number {
		return this.toolsCacheTimestamp > 0 ? Date.now() - this.toolsCacheTimestamp : 0;
	}

	// ── Tool invocation ──

	toCustomActions(): CustomCommandSpec[] {
		const { z } = require('zod');
		const tools = this.getTools();

		return tools.map((tool) => ({
			name: `mcp_${tool.name}`,
			description: `[MCP] ${tool.description}`,
			schema: z.object({}),
			handler: async (params: Record<string, unknown>) => {
				const result = await this.callTool(tool.name, params);
				return {
					success: true,
					extractedContent: typeof result === 'string' ? result : JSON.stringify(result),
				};
			},
		}));
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		const result = (await this.send('tools/call', { name, arguments: args })) as {
			content: Array<{ type: string; text?: string }>;
			isError?: boolean;
		};

		if (result.isError) {
			const errorText = result.content?.find((c) => c.type === 'text')?.text;
			throw new Error(errorText ?? 'MCP tool call failed');
		}

		const textContent = result.content?.find((c) => c.type === 'text');
		return textContent?.text ?? result;
	}

	// ── Health check ──

	/** Send a ping to verify the server is responsive. Rejects if no pong within timeout. */
	async ping(): Promise<void> {
		await this.send('ping', {});
	}

	private startHealthChecks(): void {
		this.stopHealthChecks();

		if (this.healthCheckIntervalMs <= 0) return;

		this.healthCheckTimer = setInterval(async () => {
			try {
				await this.ping();
			} catch {
				logger.warn('Health check failed');
			}
		}, this.healthCheckIntervalMs);
	}

	private stopHealthChecks(): void {
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			this.healthCheckTimer = null;
		}
	}

	// ── JSON-RPC transport ──

	private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.process?.stdin?.writable) {
			return Promise.reject(new Error('MCP client is not connected'));
		}

		const id = ++this.requestId;

		return new Promise((resolve, reject) => {
			// Per-call timeout
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`MCP request timed out after ${this.requestTimeoutMs}ms: ${method}`));
			}, this.requestTimeoutMs);

			this.pendingRequests.set(id, { resolve, reject, timer, method });

			const request = JSON.stringify({
				jsonrpc: '2.0',
				id,
				method,
				params,
			});

			this.process?.stdin?.write(`${request}\n`);
		});
	}

	/** Send a JSON-RPC notification (no id, no response expected). */
	private sendNotification(method: string, params?: Record<string, unknown>): void {
		if (!this.process?.stdin?.writable) return;

		const notification = JSON.stringify({
			jsonrpc: '2.0',
			method,
			...(params ? { params } : {}),
		});

		this.process.stdin.write(`${notification}\n`);
	}

	private processBuffer(): void {
		const lines = this.buffer.split('\n');
		this.buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const message = JSON.parse(line);

				// JSON-RPC notification from server (no id field)
				if (message.id === undefined || message.id === null) {
					this.handleServerNotification(message);
					continue;
				}

				// Response to a pending request
				const pending = this.pendingRequests.get(message.id);
				if (pending) {
					clearTimeout(pending.timer);
					this.pendingRequests.delete(message.id);
					if (message.error) {
						pending.reject(new Error(message.error.message));
					} else {
						pending.resolve(message.result);
					}
				}
			} catch {
				// Ignore malformed responses
			}
		}
	}

	private handleServerNotification(message: {
		method: string;
		params?: Record<string, unknown>;
	}): void {
		logger.debug(`Server notification: ${message.method}`);
		this.emit('notification', message.method, message.params);

		// If server signals tool list changed, invalidate cache
		if (message.method === 'notifications/tools/list_changed') {
			this.invalidateToolCache();
		}
	}

	// ── Graceful shutdown ──

	/**
	 * Disconnect gracefully: wait for pending requests to drain (up to a timeout),
	 * then kill the server process.
	 */
	async disconnect(drainTimeoutMs = 5000): Promise<void> {
		this.stopHealthChecks();

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		// Wait for pending requests to drain
		if (this.pendingRequests.size > 0) {
			logger.debug(
				`Waiting for ${this.pendingRequests.size} pending request(s) to drain...`,
			);

			await Promise.race([
				this.waitForPendingDrain(),
				new Promise<void>((resolve) => setTimeout(resolve, drainTimeoutMs)),
