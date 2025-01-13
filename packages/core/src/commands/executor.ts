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
