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
