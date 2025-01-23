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

export interface MCPNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown>;
}

// ── Resource types ──

export interface MCPResource {
	uri: string;
	name: string;
	description: string;
	mimeType: string;
}

export interface MCPResourceContent {
	uri: string;
	mimeType: string;
	text?: string;
	blob?: string;
}

// ── Subscription tracking ──

interface ResourceSubscription {
	uri: string;
	/** Callback that receives the notification to send to the client */
	notify: (notification: MCPNotification) => void;
}

/**
 * MCP (Model Context Protocol) server that exposes browser actions as tools
 * and browser state as resources. Supports stdio and SSE transports.
 *
