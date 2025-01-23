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
 * Implements:
 * - initialize / tools/list / tools/call (existing)
 * - resources/list / resources/read (browser state as resources)
 * - resources/subscribe / resources/unsubscribe (live updates)
 * - notifications/progress (step progress notifications)
 * - SSE transport via HTTP
 */
export class BridgeServer {
	private controller: BridgeAdapter;
	private browser: Viewport;
	private domService: PageAnalyzer;
	private tools: CommandExecutor;
	private name: string;
	private version: string;
	private ssePort: number;

	/** Active SSE connections that receive notifications */
	private sseClients = new Set<ServerResponse>();

	/** Resource subscriptions keyed by URI */
	private subscriptions = new Map<string, Set<ResourceSubscription>>();

	/** Last screenshot base64 cache for resource reads */
	private lastScreenshotBase64: string | null = null;

	/** HTTP server reference for SSE transport */
	private httpServer: import('node:http').Server | null = null;

	constructor(options: BridgeServerOptions) {
		this.browser = options.browser;
		this.domService = options.domService;
		this.tools = options.tools;
		this.controller = new BridgeAdapter(options.tools);
		this.name = options.name ?? 'open-browser';
		this.version = options.version ?? '0.1.0';
		this.ssePort = options.ssePort ?? 3100;
	}

	// ── Static resource definitions ──

	private getResourceDefinitions(): MCPResource[] {
		return [
			{
				uri: 'browser://state',
				name: 'Browser State',
				description: 'Current browser state summary including URL, title, and active tab',
				mimeType: 'application/json',
			},
			{
				uri: 'browser://dom',
				name: 'DOM Tree',
				description: 'Current page DOM tree serialized for LLM consumption',
				mimeType: 'text/plain',
			},
			{
				uri: 'browser://screenshot',
				name: 'Screenshot',
				description: 'Last screenshot of the current page as base64 PNG',
				mimeType: 'image/png',
			},
			{
				uri: 'browser://tabs',
				name: 'Open Tabs',
				description: 'List of all open browser tabs with URLs and titles',
				mimeType: 'application/json',
			},
		];
	}

	// ── Request dispatcher ──
