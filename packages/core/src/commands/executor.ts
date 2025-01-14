import type { Page, CDPSession } from 'playwright';
import { z } from 'zod';
import { CommandCatalog } from './catalog/catalog.js';
import type {
	Command,
	CommandResult,
	ExecutionContext,
	InterpretedViewportError,
	ViewportErrorCategory,
} from './types.js';
import {
	TapCommandSchema,
	TypeTextCommandSchema,
	NavigateCommandSchema,
	BackCommandSchema,
	ScrollCommandSchema,
	PressKeysCommandSchema,
	ExtractCommandSchema,
	FinishCommandSchema,
	FocusTabCommandSchema,
	NewTabCommandSchema,
	CloseTabCommandSchema,
	WebSearchCommandSchema,
	UploadCommandSchema,
	SelectCommandSchema,
	CaptureCommandSchema,
	ReadPageCommandSchema,
	WaitCommandSchema,
	ScrollToCommandSchema,
	FindCommandSchema,
	SearchCommandSchema,
	ListOptionsCommandSchema,
	PickOptionCommandSchema,
	ExtractStructuredCommandSchema,
} from './types.js';
import type { Viewport } from '../viewport/viewport.js';
import type { PageAnalyzer } from '../page/page-analyzer.js';
import type { LanguageModel } from '../model/interface.js';
import { ContentExtractor } from './extraction/extractor.js';
import { scrollPage, scrollElement, buildGoogleSearchUrl } from './utils.js';
import { extractMarkdown } from '../page/content-extractor.js';
import { isUrlPermitted } from '../utils.js';
import {
	UrlBlockedError,
	NavigationFailedError,
	ViewportCrashedError,
} from '../errors.js';
import { sleep } from '../utils.js';

export interface CommandExecutorOptions {
	model?: LanguageModel;
	allowedUrls?: string[];
	blockedUrls?: string[];
	commandsPerStep?: number;
}

export class CommandExecutor {
	readonly registry: CommandCatalog
	private extractionService?: ContentExtractor;
	private allowedUrls?: string[];
	private blockedUrls?: string[];
	readonly commandsPerStep: number;
	private coordinateClickingEnabled = false;

	constructor(options?: CommandExecutorOptions) {
		this.registry = new CommandCatalog();
		this.allowedUrls = options?.allowedUrls;
		this.blockedUrls = options?.blockedUrls;
		this.commandsPerStep = options?.commandsPerStep ?? 10;

		if (options?.model) {
			this.extractionService = new ContentExtractor(options.model);
		}

		this.registerBuiltinActions();
	}

	/**
	 * Enable or disable coordinate-based clicking.
	 * When enabled, click actions with coordinateX/coordinateY will use
	 * page.mouse.click instead of element index lookup.
	 */
	setCoordinateClicking(enabled: boolean): void {
		this.coordinateClickingEnabled = enabled;
	}

	private registerBuiltinActions(): void {
		// Click
		this.registry.register({
			name: 'tap',
			description: 'Click on an element by its index',
			schema: TapCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { index, clickCount, coordinateX, coordinateY } = params as {
					index: number;
					clickCount?: number;
					coordinateX?: number;
					coordinateY?: number;
				};

				// Coordinate-based clicking
				if (
					this.coordinateClickingEnabled &&
					coordinateX !== undefined &&
					coordinateY !== undefined
				) {
					const clicks = clickCount ?? 1;
					for (let i = 0; i < clicks; i++) {
						await ctx.page.mouse.click(coordinateX, coordinateY);
					}
					return { success: true };
				}

				await ctx.domService.clickElementByIndex(ctx.page, ctx.cdpSession, index);
				if (clickCount && clickCount > 1) {
					for (let i = 1; i < clickCount; i++) {
						await ctx.domService.clickElementByIndex(ctx.page, ctx.cdpSession, index);
					}
				}
				return { success: true };
			},
		});

		// Input text
		this.registry.register({
			name: 'type_text',
			description: 'Type text into an input element',
			schema: TypeTextCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { index, text, clearFirst } = params as {
					index: number;
					text: string;
					clearFirst?: boolean;
				};
				await ctx.domService.inputTextByIndex(
					ctx.page,
					ctx.cdpSession,
					index,
					text,
					clearFirst ?? true,
				);
				return { success: true };
			},
		});

		// Navigate
		this.registry.register({
			name: 'navigate',
			description: 'Navigate to a URL',
			schema: NavigateCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { url } = params as { url: string };
				if (!isUrlPermitted(url, this.allowedUrls, this.blockedUrls)) {
					throw new UrlBlockedError(url);
				}
				await ctx.browserSession.navigate(url);
				return { success: true };
			},
		});

		// Go back
		this.registry.register({
			name: 'back',
			description: 'Go back to previous page',
			schema: BackCommandSchema.omit({ action: true }),
			handler: async (_params, ctx) => {
				await ctx.page.goBack({ timeout: 5000 }).catch(() => {});
				await ctx.browserSession.waitForPageReady();
				return { success: true };
			},
		});

		// Scroll
		this.registry.register({
			name: 'scroll',
			description: 'Scroll the page or an element',
			schema: ScrollCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { direction, amount, index } = params as {
					direction: 'up' | 'down';
					amount?: number;
					index?: number;
				};

				if (index !== undefined) {
					const selector = await ctx.domService.getElementSelector(index);
					if (selector) {
						await scrollElement(ctx.page, selector, direction, amount);
					}
				} else {
					await scrollPage(ctx.page, direction, amount);
				}

				return { success: true };
			},
		});

		// Send keys
		this.registry.register({
			name: 'press_keys',
			description: 'Send keyboard keys (e.g., Enter, Escape, Control+a)',
			schema: PressKeysCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { keys } = params as { keys: string };
				await ctx.page.keyboard.press(keys);
				return { success: true };
			},
		});

		// Extract content
		this.registry.register({
			name: 'extract',
			description: 'Extract specific information from the current page',
			schema: ExtractCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { goal, outputSchema } = params as {
					goal: string;
					outputSchema?: Record<string, unknown>;
				};

				// Use the extraction LLM from context if available, otherwise fall back
				const extractionModel = ctx.extractionLlm;
				const service =
					extractionModel
						? new ContentExtractor(extractionModel)
						: this.extractionService;

				if (!service) {
					// Fallback: just extract markdown
					const markdown = await extractMarkdown(ctx.page);
					return {
						success: true,
						extractedContent: markdown.slice(0, 5000),
						includeInMemory: true,
					};
				}

				// If an outputSchema is provided, use structured extraction from text
				if (outputSchema) {
					const markdown = await extractMarkdown(ctx.page);
					const content = await service.extractFromText(
						markdown.slice(0, 8000),
						goal,
						outputSchema,
					);
					return { success: true, extractedContent: content, includeInMemory: true };
				}

				const content = await service.extract(ctx.page, goal);
				return { success: true, extractedContent: content, includeInMemory: true };
			},
		});

		// Done
		this.registry.register({
			name: 'finish',
			description: 'Mark the task as completed with a result',
			schema: FinishCommandSchema.omit({ action: true }),
			terminatesSequence: true,
			handler: async (params) => {
				const { text, success } = params as { text: string; success?: boolean };
				return {
					success: success ?? true,
					isDone: true,
					extractedContent: text,
					includeInMemory: true,
				};
			},
		});

		// Switch tab
		this.registry.register({
			name: 'focus_tab',
			description: 'Switch to a different browser tab',
			schema: FocusTabCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { tabIndex } = params as { tabIndex: number };
				await ctx.browserSession.switchTab(tabIndex);
				return { success: true };
			},
		});

		// Open tab
		this.registry.register({
			name: 'new_tab',
			description: 'Open a new tab with a URL',
			schema: NewTabCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { url } = params as { url: string };
				if (!isUrlPermitted(url, this.allowedUrls, this.blockedUrls)) {
					throw new UrlBlockedError(url);
				}
				await ctx.browserSession.newTab(url);
				return { success: true };
			},
		});

		// Close tab
		this.registry.register({
			name: 'close_tab',
			description: 'Close a browser tab',
			schema: CloseTabCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { tabIndex } = params as { tabIndex?: number };
				await ctx.browserSession.closeTab(tabIndex);
				return { success: true };
			},
		});

		// Search Google
		this.registry.register({
			name: 'web_search',
			description: 'Search Google for a query',
			schema: WebSearchCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { query } = params as { query: string };
				const url = buildGoogleSearchUrl(query);
				await ctx.browserSession.navigate(url);
				return { success: true };
			},
		});

		// Upload file
		this.registry.register({
			name: 'upload',
			description: 'Upload files to a file input',
			schema: UploadCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { index, filePaths } = params as { index: number; filePaths: string[] };

				// If a fileSystem is available in context, resolve relative paths
				// against the sandbox directory
				let resolvedPaths = filePaths;
				if (ctx.fileSystem) {
					const sandboxDir = ctx.fileSystem.getSandboxDir();
					const { resolve: pathResolve } = await import('node:path');
					resolvedPaths = filePaths.map((fp) =>
						fp.startsWith('/') ? fp : pathResolve(sandboxDir, fp),
					);
				}

				const selector = await ctx.domService.getElementSelector(index);
				if (!selector) {
					return { success: false, error: `Element ${index} not found` };
				}
				const fileInput = await ctx.page.$(selector);
				if (!fileInput) {
					return { success: false, error: `File input element not found` };
				}
				await fileInput.setInputFiles(resolvedPaths);
				return { success: true };
			},
		});

		// Select option
		this.registry.register({
			name: 'select',
			description: 'Select an option in a dropdown',
			schema: SelectCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { index, value } = params as { index: number; value: string };
				const selector = await ctx.domService.getElementSelector(index);
				if (!selector) {
					return { success: false, error: `Element ${index} not found` };
				}
				await ctx.page.selectOption(selector, value);
				return { success: true };
			},
		});

		// Screenshot
		this.registry.register({
			name: 'capture',
			description: 'Take a screenshot of the current page',
			schema: CaptureCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { fullPage } = params as { fullPage?: boolean };
				const result = await ctx.browserSession.screenshot(fullPage);
				return {
					success: true,
					extractedContent: `Screenshot taken (${result.width}x${result.height})`,
				};
			},
		});

		// Read content
		this.registry.register({
			name: 'read_page',
			description: 'Read the text content of the current page',
			schema: ReadPageCommandSchema.omit({ action: true }),
			handler: async (_params, ctx) => {
				const markdown = await extractMarkdown(ctx.page);
				return {
					success: true,
					extractedContent: markdown.slice(0, 10000),
					includeInMemory: true,
				};
			},
		});

		// Wait
		this.registry.register({
			name: 'wait',
			description: 'Wait for a specified number of seconds',
			schema: WaitCommandSchema.omit({ action: true }),
			handler: async (params) => {
				const { seconds } = params as { seconds?: number };
				await sleep((seconds ?? 3) * 1000);
				return { success: true };
			},
		});

		// ── New actions ──

		// Scroll to text
		this.registry.register({
			name: 'scroll_to',
			description: 'Scroll to a specific text on the page',
			schema: ScrollToCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { text } = params as { text: string };

				const found = await ctx.page.evaluate((searchText: string) => {
					// Use TreeWalker to find text nodes containing the search text
					const walker = document.createTreeWalker(
						document.body,
						NodeFilter.SHOW_TEXT,
						{
							acceptNode(node) {
								if (
									node.textContent &&
									node.textContent.toLowerCase().includes(searchText.toLowerCase())
								) {
									return NodeFilter.FILTER_ACCEPT;
								}
								return NodeFilter.FILTER_REJECT;
							},
						},
					);

					const node = walker.nextNode();
					if (!node?.parentElement) return false;

					node.parentElement.scrollIntoView({
						behavior: 'smooth',
						block: 'center',
					});
					return true;
				}, text);

				if (!found) {
					return {
						success: false,
						error: `Text "${text}" not found on the page`,
					};
				}

				// Allow time for the smooth scroll to finish
				await sleep(500);
				return { success: true };
			},
		});

		// Find elements
		this.registry.register({
			name: 'find',
			description: 'Find elements on the page matching a description',
			schema: FindCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { query } = params as { query: string };

				const elements = await ctx.page.evaluate((searchQuery: string) => {
					const results: Array<{
						tag: string;
						text: string;
						attributes: Record<string, string>;
					}> = [];
					const queryLower = searchQuery.toLowerCase();

					// Search through interactive and content elements
					const selectors = [
						'a',
						'button',
						'input',
						'select',
						'textarea',
						'[role="button"]',
						'[role="link"]',
						'[role="tab"]',
						'[role="menuitem"]',
						'h1',
						'h2',
						'h3',
						'h4',
						'h5',
						'h6',
						'label',
						'[aria-label]',
					];

					for (const selector of selectors) {
						for (const el of document.querySelectorAll(selector)) {
							const htmlEl = el as HTMLElement;
							const text = (htmlEl.innerText || htmlEl.textContent || '').trim();
							const ariaLabel = el.getAttribute('aria-label') || '';
							const placeholder = el.getAttribute('placeholder') || '';
							const title = el.getAttribute('title') || '';

							const searchableText =
								`${text} ${ariaLabel} ${placeholder} ${title}`.toLowerCase();

							if (searchableText.includes(queryLower)) {
								const attrs: Record<string, string> = {};
								if (el.id) attrs.id = el.id;
								if (el.className && typeof el.className === 'string') {
									attrs.class = el.className;
								}
								if (ariaLabel) attrs['aria-label'] = ariaLabel;
								if (placeholder) attrs.placeholder = placeholder;

								results.push({
									tag: el.tagName.toLowerCase(),
									text: text.slice(0, 100),
									attributes: attrs,
								});
							}

							// Cap at 20 results
							if (results.length >= 20) break;
						}
						if (results.length >= 20) break;
					}

					return results;
				}, query);

				if (elements.length === 0) {
					return {
						success: true,
						extractedContent: `No elements found matching "${query}"`,
						includeInMemory: true,
					};
				}

				const descriptions = elements.map((el, i) => {
					const attrStr = Object.entries(el.attributes)
						.map(([k, v]) => `${k}="${v}"`)
						.join(' ');
					return `[${i}] <${el.tag}${attrStr ? ` ${attrStr}` : ''}> ${el.text}`;
				});

				return {
					success: true,
					extractedContent: `Found ${elements.length} element(s):\n${descriptions.join('\n')}`,
					includeInMemory: true,
				};
			},
		});

		// Search page (multi-engine)
		this.registry.register({
			name: 'search',
			description: 'Search the web using a specified search engine',
			schema: SearchCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { query, engine } = params as {
					query: string;
					engine?: 'google' | 'duckduckgo' | 'bing';
				};

				const searchEngine = engine ?? 'google';
				const url = buildSearchUrl(query, searchEngine);

				if (!isUrlPermitted(url, this.allowedUrls, this.blockedUrls)) {
					throw new UrlBlockedError(url);
				}

				await ctx.browserSession.navigate(url);
				return { success: true };
			},
		});

		// Get dropdown options
		this.registry.register({
			name: 'list_options',
			description: 'Get all options from a select/dropdown element',
			schema: ListOptionsCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { index } = params as { index: number };
				const selector = await ctx.domService.getElementSelector(index);
				if (!selector) {
					return { success: false, error: `Element ${index} not found` };
				}

				const options = await ctx.page.evaluate((sel: string) => {
					const selectEl = document.querySelector(sel) as HTMLSelectElement | null;
					if (!selectEl || selectEl.tagName !== 'SELECT') {
						return null;
					}

					return Array.from(selectEl.options).map((opt) => ({
						value: opt.value,
						text: opt.text.trim(),
						selected: opt.selected,
					}));
				}, selector);

				if (!options) {
					return {
						success: false,
						error: `Element ${index} is not a select element`,
					};
				}

				const formatted = options
					.map(
						(opt, i) =>
							`[${i}] "${opt.text}" (value="${opt.value}")${opt.selected ? ' [selected]' : ''}`,
					)
					.join('\n');

				return {
					success: true,
					extractedContent: `Dropdown options:\n${formatted}`,
					includeInMemory: true,
				};
			},
		});

		// Select dropdown option (by text match)
		this.registry.register({
			name: 'pick_option',
			description: 'Select a dropdown option by its visible text',
			schema: PickOptionCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { index, optionText } = params as {
					index: number;
					optionText: string;
				};
				const selector = await ctx.domService.getElementSelector(index);
				if (!selector) {
					return { success: false, error: `Element ${index} not found` };
				}

				// Find the option value by matching text content
				const matchedValue = await ctx.page.evaluate(
					({ sel, text }: { sel: string; text: string }) => {
						const selectEl = document.querySelector(sel) as HTMLSelectElement | null;
						if (!selectEl || selectEl.tagName !== 'SELECT') return null;

						const textLower = text.toLowerCase();

						// Try exact match first
						for (const opt of selectEl.options) {
							if (opt.text.trim().toLowerCase() === textLower) {
								return opt.value;
							}
						}

						// Try partial / includes match
						for (const opt of selectEl.options) {
							if (opt.text.trim().toLowerCase().includes(textLower)) {
								return opt.value;
							}
						}

						return null;
					},
					{ sel: selector, text: optionText },
				);

				if (matchedValue === null) {
					return {
						success: false,
						error: `No option matching "${optionText}" found in dropdown at element ${index}`,
					};
				}

				await ctx.page.selectOption(selector, matchedValue);
				return { success: true };
			},
		});

		// Structured output
		this.useStructuredOutputAction();
	}

	/**
	 * Register the structured_output action.
	 * Uses the extraction LLM to produce structured JSON output from
	 * the current page content according to a caller-provided JSON schema.
	 */
	private useStructuredOutputAction(): void {
		this.registry.register({
			name: 'extract_structured',
			description:
				'Extract structured data from the current page content. Returns JSON conforming to the provided schema.',
			schema: ExtractStructuredCommandSchema.omit({ action: true }),
			handler: async (params, ctx) => {
				const { goal, outputSchema, maxContentLength } = params as {
					goal: string;
					outputSchema: Record<string, unknown>;
					maxContentLength?: number;
				};

				const contentLimit = maxContentLength ?? 8000;

				// Resolve the extraction model: prefer context-provided, fall back to Tools-level
				const extractionModel = ctx.extractionLlm;
				const service = extractionModel
					? new ContentExtractor(extractionModel)
					: this.extractionService;

				if (!service) {
					return {
						success: false,
						error:
							'No extraction LLM configured. Provide a model via CommandExecutorOptions or ExecutionContext.extractionLlm.',
					};
				}

				// Extract page content as markdown
				const markdown = await extractMarkdown(ctx.page);
				if (!markdown.trim()) {
					return {
						success: false,
						error: 'No content found on the page for structured extraction.',
					};
				}

				const truncatedContent = markdown.slice(0, contentLimit);

				try {
					const result = await service.extractFromText(
						truncatedContent,
