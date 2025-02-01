import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { BridgeServer, type MCPRequest, type MCPResponse } from './server.js';
import { CommandExecutor } from '../commands/executor.js';

// ── Mock factories ──

function makeMockViewport() {
	return {
		currentPage: {
			goBack: mock(() => Promise.resolve()),
			evaluate: mock(() => Promise.resolve({})),
			mouse: { click: mock(() => Promise.resolve()) },
			keyboard: { press: mock(() => Promise.resolve()) },
		},
		cdp: {
			send: mock(() => Promise.resolve({})),
		},
		navigate: mock(() => Promise.resolve()),
		waitForPageReady: mock(() => Promise.resolve()),
		switchTab: mock(() => Promise.resolve()),
		newTab: mock(() => Promise.resolve()),
		closeTab: mock(() => Promise.resolve()),
		screenshot: mock(() =>
			Promise.resolve({ base64: 'abc123', width: 1280, height: 800 }),
		),
		isConnected: true,
		getState: mock(() =>
			Promise.resolve({
				url: 'https://example.com',
				title: 'Example',
				tabs: [{ url: 'https://example.com', title: 'Example' }],
			}),
		),
	} as any;
}

function makeMockPageAnalyzer() {
	return {
		extractState: mock(() =>
			Promise.resolve({
				tree: '<html>...</html>',
				selectorMap: {},
				elementCount: 5,
				interactiveElementCount: 2,
				scrollPosition: { x: 0, y: 0 },
				viewportSize: { width: 1280, height: 800 },
				documentSize: { width: 1280, height: 2000 },
				pixelsAbove: 0,
				pixelsBelow: 1200,
			}),
		),
		clickElementByIndex: mock(() => Promise.resolve()),
		inputTextByIndex: mock(() => Promise.resolve()),
		getElementSelector: mock(() => Promise.resolve('#el')),
	} as any;
}

function makeRequest(
	method: string,
	id: number | string = 1,
	params?: Record<string, unknown>,
): MCPRequest & { id: number | string } {
	return {
		jsonrpc: '2.0' as const,
		id,
		method,
		...(params ? { params } : {}),
	};
}

// ── Tests ──

describe('BridgeServer', () => {
	let server: BridgeServer;
	let browser: ReturnType<typeof makeMockViewport>;
	let domService: ReturnType<typeof makeMockPageAnalyzer>;
	let tools: CommandExecutor;

	beforeEach(() => {
		browser = makeMockViewport();
		domService = makeMockPageAnalyzer();
		tools = new CommandExecutor();

		server = new BridgeServer({
			browser,
			domService,
			tools,
			name: 'test-server',
			version: '1.0.0',
		});
	});

	describe('handleRequest: initialize', () => {
		test('returns server info and capabilities', async () => {
			const response = await server.handleRequest(makeRequest('initialize'));

			expect(response.jsonrpc).toBe('2.0');
			expect(response.id).toBe(1);
			expect(response.result).toBeDefined();

			const result = response.result as any;
			expect(result.protocolVersion).toBe('2024-11-05');
			expect(result.serverInfo.name).toBe('test-server');
			expect(result.serverInfo.version).toBe('1.0.0');
			expect(result.capabilities.tools).toBeDefined();
			expect(result.capabilities.resources).toBeDefined();
			expect(result.capabilities.resources.subscribe).toBe(true);
		});
	});

	describe('handleRequest: tools/list', () => {
		test('returns list of available tools', async () => {
			const response = await server.handleRequest(makeRequest('tools/list'));

			expect(response.result).toBeDefined();
			const result = response.result as any;
			expect(Array.isArray(result.tools)).toBe(true);
			expect(result.tools.length).toBeGreaterThan(0);

			// Each tool should have name, description, inputSchema
			const firstTool = result.tools[0];
			expect(firstTool.name).toBeDefined();
			expect(firstTool.description).toBeDefined();
			expect(firstTool.inputSchema).toBeDefined();

			// Tool names should be prefixed with browser_
			expect(firstTool.name.startsWith('browser_')).toBe(true);
		});
	});

	describe('handleRequest: tools/call', () => {
		test('executes a browser tool and returns result', async () => {
			const response = await server.handleRequest(
				makeRequest('tools/call', 1, {
					name: 'browser_tap',
					arguments: { index: 0 },
				}),
			);

			expect(response.result).toBeDefined();
			const result = response.result as any;
			expect(result.content).toBeDefined();
			expect(Array.isArray(result.content)).toBe(true);
			expect(result.content[0].type).toBe('text');
			expect(result.isError).toBe(false);
		});

		test('returns error for unknown tool', async () => {
			const response = await server.handleRequest(
				makeRequest('tools/call', 1, {
					name: 'unknown_tool',
					arguments: {},
				}),
			);

			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32602);
			expect(response.error!.message).toContain('Unknown tool');
		});

