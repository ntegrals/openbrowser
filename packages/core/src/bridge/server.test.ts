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
