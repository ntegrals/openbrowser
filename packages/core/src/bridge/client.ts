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
