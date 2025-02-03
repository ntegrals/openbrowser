import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { CommandExecutor } from './executor.js';
import type { Command, ExecutionContext, CommandResult } from './types.js';
import { UrlBlockedError, CommandFailedError } from '../errors.js';

// ── Mock factories ──

function makeMockPageAnalyzer() {
	return {
		clickElementByIndex: mock(() => Promise.resolve()),
		inputTextByIndex: mock(() => Promise.resolve()),
		getElementSelector: mock(() => Promise.resolve('#selector')),
		extractState: mock(() =>
			Promise.resolve({
				tree: '<html></html>',
				selectorMap: {},
				elementCount: 0,
				interactiveElementCount: 0,
				scrollPosition: { x: 0, y: 0 },
				viewportSize: { width: 1280, height: 800 },
				documentSize: { width: 1280, height: 2000 },
				pixelsAbove: 0,
				pixelsBelow: 0,
			}),
		),
	} as any;
}

function makeMockViewport() {
	return {
		navigate: mock(() => Promise.resolve()),
		waitForPageReady: mock(() => Promise.resolve()),
		switchTab: mock(() => Promise.resolve()),
		newTab: mock(() => Promise.resolve()),
		closeTab: mock(() => Promise.resolve()),
		screenshot: mock(() =>
			Promise.resolve({ base64: 'abc', width: 1280, height: 800 }),
		),
		currentPage: makeMockPage(),
		cdp: makeMockCdpSession(),
