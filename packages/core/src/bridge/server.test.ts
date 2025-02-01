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
