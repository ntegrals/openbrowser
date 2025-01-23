import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Viewport } from '../viewport/viewport.js';
import type { PageAnalyzer } from '../page/page-analyzer.js';
import type { CommandExecutor } from '../commands/executor.js';
import type { ExecutionContext } from '../commands/types.js';
import { BridgeAdapter, type MCPToolDefinition } from './adapter.js';
import { createLogger } from '../logging.js';

const logger = createLogger('mcp-server');

// ── JSON-RPC types ──

export interface BridgeServerOptions {
	browser: Viewport;
	domService: PageAnalyzer;
	tools: CommandExecutor;
	name?: string;
	version?: string;
	/** Port for SSE transport (default: 3100) */
	ssePort?: number;
}

export interface MCPRequest {
	jsonrpc: '2.0';
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
}

export interface MCPResponse {
	jsonrpc: '2.0';
	id: string | number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}
