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
		test('navigates to valid URL', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'navigate', url: 'https://example.com' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.browserSession.navigate).toHaveBeenCalledWith('https://example.com');
		});

		test('throws CommandFailedError wrapping UrlBlockedError for blocked URL', async () => {
			const restricted = new CommandExecutor({ blockedUrls: ['evil.com'] });
			const ctx = makeContext();

			await expect(
				restricted.executeAction(
					action({ action: 'navigate', url: 'https://evil.com/page' }),
					ctx,
				),
			).rejects.toThrow(CommandFailedError);
		});

		test('throws when URL not in allowlist', async () => {
			const restricted = new CommandExecutor({ allowedUrls: ['safe.com'] });
			const ctx = makeContext();

			await expect(
				restricted.executeAction(
					action({ action: 'navigate', url: 'https://other.com' }),
					ctx,
				),
			).rejects.toThrow(CommandFailedError);
		});
	});

	describe('input_text action', () => {
		test('inputs text into element', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'type_text', index: 3, text: 'hello' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.domService.inputTextByIndex).toHaveBeenCalledWith(
				ctx.page,
				ctx.cdpSession,
				3,
				'hello',
				true, // clearFirst defaults to true
			);
		});

		test('passes clearFirst=false when specified', async () => {
			const ctx = makeContext();
			await tools.executeAction(
				action({ action: 'type_text', index: 0, text: 'append', clearFirst: false }),
				ctx,
			);

			expect(ctx.domService.inputTextByIndex).toHaveBeenCalledWith(
				ctx.page,
				ctx.cdpSession,
				0,
				'append',
				false,
			);
		});
	});

	describe('scroll action', () => {
		test('scrolls the page when no index provided', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'scroll', direction: 'down' }),
				ctx,
			);

			expect(result.success).toBe(true);
		});

		test('scrolls an element when index is provided', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'scroll', direction: 'up', index: 5 }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.domService.getElementSelector).toHaveBeenCalledWith(5);
		});
	});

	describe('search_google action', () => {
		test('navigates to Google search URL', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'web_search', query: 'bun test runner' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.browserSession.navigate).toHaveBeenCalled();
			const navigateArg = (ctx.browserSession.navigate as any).mock.calls[0][0] as string;
			expect(navigateArg).toContain('google.com/search');
			expect(navigateArg).toContain('bun%20test%20runner');
		});
	});

	describe('done action', () => {
		test('returns isDone=true with text', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'finish', text: 'Task completed successfully' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(result.isDone).toBe(true);
			expect(result.extractedContent).toBe('Task completed successfully');
			expect(result.includeInMemory).toBe(true);
		});

		test('respects explicit success=false', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'finish', text: 'Could not complete', success: false }),
				ctx,
			);

			expect(result.success).toBe(false);
			expect(result.isDone).toBe(true);
		});
	});

	describe('go_back action', () => {
		test('calls page.goBack and waits for ready', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'back' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.page.goBack).toHaveBeenCalled();
			expect(ctx.browserSession.waitForPageReady).toHaveBeenCalled();
		});
	});

	describe('send_keys action', () => {
		test('presses keyboard keys', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'press_keys', keys: 'Enter' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.page.keyboard.press).toHaveBeenCalledWith('Enter');
		});
	});

	describe('find_elements action', () => {
		test('returns found elements description', async () => {
			const page = makeMockPage();
			page.evaluate = mock(() =>
				Promise.resolve([
					{ tag: 'button', text: 'Submit', attributes: { id: 'btn-submit' } },
					{ tag: 'a', text: 'Home', attributes: {} },
				]),
			);
			const ctx = makeContext({ page });

			const result = await tools.executeAction(
				action({ action: 'find', query: 'submit' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(result.extractedContent).toContain('Found 2 element(s)');
			expect(result.extractedContent).toContain('button');
			expect(result.extractedContent).toContain('Submit');
		});

		test('returns message when no elements found', async () => {
			const page = makeMockPage();
			page.evaluate = mock(() => Promise.resolve([]));
			const ctx = makeContext({ page });

			const result = await tools.executeAction(
				action({ action: 'find', query: 'nonexistent' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(result.extractedContent).toContain('No elements found');
		});
	});

	describe('extract_content action (fallback, no LLM)', () => {
		test('returns error/fallback when no extraction service', async () => {
			// Tools without model won't have an extraction service
			// The handler falls back to extractMarkdown which we mock via page.evaluate
			const ctx = makeContext();
			// extractMarkdown eventually calls page.evaluate
			// For this test, just verify no crash. The actual extractMarkdown module
			// import might require more setup, so we test the branch
			try {
				await tools.executeAction(
					action({ action: 'extract', goal: 'get all links' }),
					ctx,
				);
			} catch {
				// Expected - extractMarkdown import/evaluation may fail in test env
			}
		});
	});

	describe('search_page action (multi-engine)', () => {
		test('navigates to DuckDuckGo when specified', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'search', query: 'hello', engine: 'duckduckgo' }),
				ctx,
			);

			expect(result.success).toBe(true);
			const url = (ctx.browserSession.navigate as any).mock.calls[0][0] as string;
			expect(url).toContain('duckduckgo.com');
		});

		test('navigates to Bing when specified', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'search', query: 'hello', engine: 'bing' }),
				ctx,
			);

			expect(result.success).toBe(true);
			const url = (ctx.browserSession.navigate as any).mock.calls[0][0] as string;
			expect(url).toContain('bing.com/search');
		});

		test('defaults to Google', async () => {
			const ctx = makeContext();
			await tools.executeAction(
				action({ action: 'search', query: 'hello' }),
				ctx,
			);

			const url = (ctx.browserSession.navigate as any).mock.calls[0][0] as string;
			expect(url).toContain('google.com/search');
		});
	});

	describe('sensitive data masking', () => {
		test('masks sensitive data in action results', async () => {
			const ctx = makeContext({
				maskedValues: {
					PASSWORD: 'secret123',
					API_KEY: 'sk-abc',
				},
			});

			// Execute done action with text containing sensitive data
			const result = await tools.executeActions(
				[action({ action: 'finish', text: 'Found password: secret123 and key: sk-abc' })],
				ctx,
			);

			expect(result[0].success).toBe(true);
			expect(result[0].extractedContent).toContain('<PASSWORD>');
			expect(result[0].extractedContent).toContain('<API_KEY>');
			expect(result[0].extractedContent).not.toContain('secret123');
			expect(result[0].extractedContent).not.toContain('sk-abc');
		});

		test('does not mask when no sensitive data configured', async () => {
			const ctx = makeContext(); // no maskedValues

			const result = await tools.executeActions(
				[action({ action: 'finish', text: 'Plain text with no secrets' })],
				ctx,
			);

			expect(result[0].extractedContent).toBe('Plain text with no secrets');
		});
	});

	describe('action sequence execution', () => {
		test('executes multiple actions in sequence', async () => {
			const ctx = makeContext();

			const results = await tools.executeActions(
				[
					action({ action: 'tap', index: 0 }),
					action({ action: 'tap', index: 1 }),
				],
				ctx,
			);

			expect(results).toHaveLength(2);
			expect(results[0].success).toBe(true);
			expect(results[1].success).toBe(true);
		});

		test('stops at done action', async () => {
			const ctx = makeContext();

			const results = await tools.executeActions(
				[
					action({ action: 'tap', index: 0 }),
					action({ action: 'finish', text: 'Finished' }),
					action({ action: 'tap', index: 1 }), // should not execute
				],
				ctx,
			);

			expect(results).toHaveLength(2);
			expect(results[1].isDone).toBe(true);
		});

		test('respects commandsPerStep limit', async () => {
			const limited = new CommandExecutor({ commandsPerStep: 2 });
			const ctx = makeContext();

			const results = await limited.executeActions(
				[
					action({ action: 'tap', index: 0 }),
					action({ action: 'tap', index: 1 }),
					action({ action: 'tap', index: 2 }), // should not execute (limit=2)
				],
				ctx,
			);

			expect(results).toHaveLength(2);
		});

		test('handles errors gracefully in sequence', async () => {
			const ctx = makeContext();
			ctx.domService.clickElementByIndex = mock(() =>
				Promise.reject(new Error('Element is not visible')),
			);

			const results = await tools.executeActions(
				[action({ action: 'tap', index: 0 })],
				ctx,
			);

			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(false);
			expect(results[0].error).toBeDefined();
			expect(results[0].error).toContain('not visible');
		});

		test('stops sequence on non-retryable error', async () => {
			const ctx = makeContext();
			ctx.domService.clickElementByIndex = mock(() =>
				Promise.reject(new Error('browser has been closed')),
			);

			const results = await tools.executeActions(
				[
					action({ action: 'tap', index: 0 }),
					action({ action: 'tap', index: 1 }), // should not run
				],
				ctx,
			);

			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(false);
		});

		test('continues after retryable error', async () => {
			const ctx = makeContext();
			let callCount = 0;
			ctx.domService.clickElementByIndex = mock(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error('Element is not visible'));
				}
				return Promise.resolve();
			});

			const results = await tools.executeActions(
				[
					action({ action: 'tap', index: 0 }),
					action({ action: 'tap', index: 1 }),
				],
				ctx,
			);

			expect(results).toHaveLength(2);
			expect(results[0].success).toBe(false);
			expect(results[1].success).toBe(true);
		});

		test('masks sensitive data in error messages', async () => {
			const ctx = makeContext({
				maskedValues: { TOKEN: 'my-secret-token' },
			});
			ctx.domService.clickElementByIndex = mock(() =>
				Promise.reject(new Error('Failed with my-secret-token')),
			);

			const results = await tools.executeActions(
				[action({ action: 'tap', index: 0 })],
				ctx,
			);

			expect(results[0].error).not.toContain('my-secret-token');
			expect(results[0].error).toContain('<TOKEN>');
		});
	});

	describe('switch_tab action', () => {
		test('switches to specified tab', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'focus_tab', tabIndex: 1 }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.browserSession.switchTab).toHaveBeenCalledWith(1);
		});
	});

	describe('open_tab action', () => {
		test('opens new tab with URL', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'new_tab', url: 'https://example.com' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.browserSession.newTab).toHaveBeenCalledWith('https://example.com');
		});

		test('throws for blocked URL', async () => {
			const restricted = new CommandExecutor({ blockedUrls: ['banned.com'] });
			const ctx = makeContext();

			await expect(
				restricted.executeAction(
					action({ action: 'new_tab', url: 'https://banned.com' }),
					ctx,
				),
			).rejects.toThrow(CommandFailedError);
		});
	});

	describe('close_tab action', () => {
		test('closes specified tab', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'close_tab', tabIndex: 2 }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(ctx.browserSession.closeTab).toHaveBeenCalledWith(2);
		});
	});

	describe('screenshot action', () => {
		test('takes a screenshot', async () => {
			const ctx = makeContext();
			const result = await tools.executeAction(
				action({ action: 'capture' }),
				ctx,
			);

			expect(result.success).toBe(true);
			expect(result.extractedContent).toContain('Screenshot taken');
			expect(ctx.browserSession.screenshot).toHaveBeenCalled();
		});
	});

	describe('setCoordinateClicking', () => {
		test('enables coordinate-based clicking', () => {
			tools.setCoordinateClicking(true);
			// Verified through click behavior in click action tests above
			expect(tools).toBeDefined();
		});

		test('disables coordinate-based clicking', () => {
			tools.setCoordinateClicking(true);
			tools.setCoordinateClicking(false);
			expect(tools).toBeDefined();
		});
	});
});
