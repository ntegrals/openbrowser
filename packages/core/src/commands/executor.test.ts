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
		isConnected: true,
	} as any;
}

function makeMockPage() {
	return {
		goBack: mock(() => Promise.resolve()),
		evaluate: mock(() => Promise.resolve([])),
		mouse: {
			click: mock(() => Promise.resolve()),
		},
		keyboard: {
			press: mock(() => Promise.resolve()),
		},
		fill: mock(() => Promise.resolve()),
		click: mock(() => Promise.resolve()),
		selectOption: mock(() => Promise.resolve()),
		$: mock(() => Promise.resolve({ setInputFiles: mock(() => Promise.resolve()) })),
	} as any;
}

function makeMockCdpSession() {
	return {
		send: mock(() => Promise.resolve({})),
	} as any;
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
	const browser = makeMockViewport();
	return {
		page: browser.currentPage,
		cdpSession: browser.cdp,
		domService: makeMockPageAnalyzer(),
		browserSession: browser,
		...overrides,
	};
}

/**
 * Helper to create action objects. Zod schemas with .default() produce
 * required fields in the inferred output type, but at runtime the defaults
 * are applied during validation. We cast through `any` to allow omitting
 * fields that have Zod defaults.
 */
function action(a: Record<string, unknown>): Command {
	return a as Command;
}

// ── Tests ──

describe('CommandExecutor', () => {
	let tools: CommandExecutor;

	beforeEach(() => {
		tools = new CommandExecutor();
	});

	describe('constructor and registration', () => {
		test('registers all built-in actions', () => {
			const names = tools.registry.getNames();
			expect(names).toContain('tap');
			expect(names).toContain('type_text');
			expect(names).toContain('navigate');
			expect(names).toContain('back');
			expect(names).toContain('scroll');
			expect(names).toContain('press_keys');
			expect(names).toContain('extract');
			expect(names).toContain('finish');
			expect(names).toContain('focus_tab');
			expect(names).toContain('new_tab');
			expect(names).toContain('close_tab');
			expect(names).toContain('web_search');
			expect(names).toContain('capture');
			expect(names).toContain('read_page');
			expect(names).toContain('wait');
			expect(names).toContain('scroll_to');
			expect(names).toContain('find');
			expect(names).toContain('search');
			expect(names).toContain('extract_structured');
		});

		test('has default commandsPerStep of 10', () => {
			expect(tools.commandsPerStep).toBe(10);
		});

		test('respects custom commandsPerStep', () => {
			const custom = new CommandExecutor({ commandsPerStep: 5 });
			expect(custom.commandsPerStep).toBe(5);
		});
	});

	describe('click action', () => {
		test('delegates to domService.clickElementByIndex', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'tap', index: 0 }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.domService.clickElementByIndex).toHaveBeenCalledWith(
				ctx.page,
				ctx.cdpSession,
				0,
			);
		});

		test('supports multiple clicks via clickCount', async () => {
			const ctx = makeContext();
			await tools.executeAction(
				action({ action: 'tap', index: 0, clickCount: 3 }),
				ctx,
			);

			// First call + 2 additional
			expect(ctx.domService.clickElementByIndex).toHaveBeenCalledTimes(3);
		});

		test('uses coordinate-based clicking when enabled', async () => {
			tools.setCoordinateClicking(true);
			const ctx = makeContext();

			const result = await tools.executeAction(
				action({ action: 'tap', index: 0, coordinateX: 100, coordinateY: 200 }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.page.mouse.click).toHaveBeenCalledWith(100, 200);
			// domService should NOT have been called
			expect(ctx.domService.clickElementByIndex).not.toHaveBeenCalled();
		});

		test('coordinate click supports clickCount', async () => {
			tools.setCoordinateClicking(true);
			const ctx = makeContext();

			await tools.executeAction(
				action({ action: 'tap', index: 0, coordinateX: 50, coordinateY: 50, clickCount: 2 }),
				ctx,
			);

			expect(ctx.page.mouse.click).toHaveBeenCalledTimes(2);
		});

		test('falls back to index-based click when coordinate clicking disabled', async () => {
			// Default: coordinate clicking is disabled
			const ctx = makeContext();

			await tools.executeAction(
				action({ action: 'tap', index: 0, coordinateX: 100, coordinateY: 200 }),
				ctx,
			);

			// Should use domService, not coordinates
			expect(ctx.domService.clickElementByIndex).toHaveBeenCalled();
		});
	});

	describe('navigate action', () => {
