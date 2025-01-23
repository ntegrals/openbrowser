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

	async handleMessage(message: MCPRequest): Promise<MCPResponse | null> {
		// JSON-RPC notifications have no `id` field -- they are fire-and-forget
		if (message.id === undefined || message.id === null) {
			await this.handleNotification(message);
			return null;
		}

		return this.handleRequest(message as MCPRequest & { id: string | number });
	}

	async handleRequest(request: MCPRequest & { id: string | number }): Promise<MCPResponse> {
		try {
			switch (request.method) {
				case 'initialize':
					return this.handleInitialize(request);
				case 'tools/list':
					return this.handleToolsList(request);
				case 'tools/call':
					return this.handleToolsCall(request);
				case 'resources/list':
					return this.handleResourcesList(request);
				case 'resources/read':
					return this.handleResourcesRead(request);
				case 'resources/subscribe':
					return this.handleResourcesSubscribe(request);
				case 'resources/unsubscribe':
					return this.handleResourcesUnsubscribe(request);
				case 'ping':
					return { jsonrpc: '2.0', id: request.id, result: {} };
				default:
					return {
						jsonrpc: '2.0',
						id: request.id,
						error: { code: -32601, message: `Method not found: ${request.method}` },
					};
			}
		} catch (error) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32603,
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	/** Handle incoming JSON-RPC notifications (no response expected). */
	private async handleNotification(message: MCPRequest): Promise<void> {
		switch (message.method) {
			case 'notifications/initialized':
				logger.debug('Client confirmed initialization');
				break;
			case 'notifications/cancelled': {
				const requestId = message.params?.requestId;
				logger.debug(`Client cancelled request ${requestId}`);
				break;
			}
			default:
				logger.debug(`Received unknown notification: ${message.method}`);
		}
	}

	// ── Protocol handlers ──

	private handleInitialize(request: MCPRequest & { id: string | number }): MCPResponse {
		return {
			jsonrpc: '2.0',
			id: request.id,
			result: {
				protocolVersion: '2024-11-05',
				capabilities: {
					tools: {},
					resources: {
						subscribe: true,
						listChanged: true,
					},
				},
				serverInfo: {
					name: this.name,
					version: this.version,
				},
			},
		};
	}

	private handleToolsList(request: MCPRequest & { id: string | number }): MCPResponse {
		const tools = this.controller.getToolDefinitions();
		return {
			jsonrpc: '2.0',
			id: request.id,
			result: {
				tools: tools.map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
				})),
			},
		};
	}

	private async handleToolsCall(request: MCPRequest & { id: string | number }): Promise<MCPResponse> {
		const params = request.params ?? {};
		const toolName = params.name as string;
		const args = (params.arguments ?? {}) as Record<string, unknown>;

		const actionName = this.controller.parseToolName(toolName);
		if (!actionName) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: { code: -32602, message: `Unknown tool: ${toolName}` },
			};
		}

		// Emit progress notification at start
		this.emitProgress(request.id, 0, `Executing ${toolName}...`);

		const context: ExecutionContext = {
			page: this.browser.currentPage,
			cdpSession: this.browser.cdp!,
			domService: this.domService,
			browserSession: this.browser,
		};

		const result = await this.tools.registry.execute(actionName, args, context);

		// Emit progress notification at completion
		this.emitProgress(request.id, 1, 'Complete');

		// Notify subscribers that browser state may have changed
		this.notifyResourceChanged('browser://state');
		this.notifyResourceChanged('browser://dom');

		return {
			jsonrpc: '2.0',
			id: request.id,
			result: {
				content: [
					{
						type: 'text',
						text: result.extractedContent ?? (result.success ? 'Success' : `Error: ${result.error}`),
					},
				],
				isError: !result.success,
			},
		};
	}

	// ── Resource handlers ──

	private handleResourcesList(request: MCPRequest & { id: string | number }): MCPResponse {
		return {
			jsonrpc: '2.0',
			id: request.id,
			result: {
				resources: this.getResourceDefinitions(),
			},
		};
	}

	private async handleResourcesRead(request: MCPRequest & { id: string | number }): Promise<MCPResponse> {
		const uri = request.params?.uri as string;
		if (!uri) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: { code: -32602, message: 'Missing required parameter: uri' },
			};
		}

		try {
			const content = await this.readResource(uri);
			return {
				jsonrpc: '2.0',
				id: request.id,
				result: {
					contents: [content],
				},
			};
		} catch (error) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32602,
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async readResource(uri: string): Promise<MCPResourceContent> {
		switch (uri) {
			case 'browser://state': {
				const state = await this.browser.getState();
				return {
					uri,
					mimeType: 'application/json',
					text: JSON.stringify(state, null, 2),
				};
			}
			case 'browser://dom': {
				const domState = await this.domService.extractState(
					this.browser.currentPage,
					this.browser.cdp!,
				);
				return {
