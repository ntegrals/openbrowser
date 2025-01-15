import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
	type CDPSession,
} from 'playwright';
import { EventHub } from './event-hub.js';
import type { ViewportEventMap, ViewportRequestMap } from './events.js';
import type { LaunchOptions, ViewportSnapshot, TabDescriptor } from './types.js';
import { LaunchProfile } from './launch-profile.js';
import { BaseGuard, type GuardContext } from './guard-base.js';
import { LaunchFailedError, ViewportCrashedError } from '../errors.js';
import { tabId, targetId, type TargetId } from '../types.js';
import { createLogger } from '../logging.js';
import { timed } from '../telemetry.js';
import { isNewTabPage } from '../utils.js';

// Watchdogs
import { LocalInstanceGuard } from './guards/local-instance.js';
import { UrlPolicyGuard } from './guards/url-policy.js';
import { DefaultHandlerGuard } from './guards/default-handler.js';
import { PopupGuard } from './guards/popups.js';
import { PageReadyGuard } from './guards/page-ready.js';
import { DownloadGuard } from './guards/downloads.js';
import { BlankPageGuard } from './guards/blank-page.js';
import { CrashGuard } from './guards/crash.js';
import { PersistenceGuard } from './guards/persistence.js';
import { ScreenshotGuard } from './guards/screenshot.js';

const logger = createLogger('browser-session');

// ── Multi-target tracking ──

/** Represents a single CDP target (page, iframe, service worker, etc.) */
export interface Target {
	targetId: TargetId;
	type: 'page' | 'iframe' | 'service_worker' | 'worker' | 'other';
	url: string;
	title: string;
}

/** Viewport dimensions as detected via CDP */
export interface ViewportInfo {
	width: number;
	height: number;
	deviceScaleFactor: number;
	isMobile: boolean;
}

export interface ViewportOptions {
	/** Launch options (or use LaunchProfile) */
	launchOptions?: Partial<LaunchOptions>;
	/** Pre-built browser profile */
	profile?: LaunchProfile;
	/** Connect to existing browser via WebSocket URL */
	wsEndpoint?: string;
	/** Connect to existing browser via CDP URL */
	cdpUrl?: string;
	/** Headless mode shortcut */
	headless?: boolean;
	/** Allowed URLs for security watchdog */
	allowedUrls?: string[];
	/** Blocked URLs for security watchdog */
	blockedUrls?: string[];
	/** Storage state file path */
	storageStatePath?: string;
	/** Extra watchdogs */
	watchdogs?: BaseGuard[];
	/** Minimum wait after page load (ms) */
	minWaitPageLoadMs?: number;
	/** Wait for network idle (ms) */
	waitForNetworkIdleMs?: number;
	/** Max wait for page load (ms) */
	maxWaitPageLoadMs?: number;
	/** Max reconnection attempts */
	maxReconnectAttempts?: number;
	/** Delay between reconnection attempts (ms) */
	reconnectDelayMs?: number;
}

export class Viewport {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private _currentPage: Page | null = null;
	private cdpSession: CDPSession | null = null;

	readonly eventBus: EventHub<ViewportEventMap, ViewportRequestMap>;
	private watchdogs: BaseGuard[] = [];
	private options: ViewportOptions;
	private launchOptions: LaunchOptions;
	private _isConnected = false;

	private readonly minWaitPageLoadMs: number;
	private readonly waitForNetworkIdleMs: number;
	private readonly maxWaitPageLoadMs: number;
	private readonly maxReconnectAttempts: number;
	private readonly reconnectDelayMs: number;

	/** Tracks known CDP targets keyed by targetId */
	private knownTargets = new Map<string, Target>();

	/** Cached viewport info, invalidated on page/tab switch */
	private cachedViewport: ViewportInfo | null = null;

	/** Tracks whether a reconnection is currently in progress */
	private reconnecting = false;

	constructor(options: ViewportOptions = {}) {
		this.options = options;
		this.eventBus = new EventHub({ maxHistory: 200 });

		if (options.profile) {
			this.launchOptions = options.profile.build();
		} else {
			this.launchOptions = {
				headless: options.headless ?? options.launchOptions?.headless ?? true,
				relaxedSecurity: options.launchOptions?.relaxedSecurity ?? false,
				extraArgs: options.launchOptions?.extraArgs ?? [],
				windowWidth: options.launchOptions?.windowWidth ?? 1280,
				windowHeight: options.launchOptions?.windowHeight ?? 1100,
				proxy: options.launchOptions?.proxy,
				userDataDir: options.launchOptions?.userDataDir,
				browserBinaryPath: options.launchOptions?.browserBinaryPath,
				persistAfterClose: options.launchOptions?.persistAfterClose ?? false,
				channelName: options.launchOptions?.channelName,
			};
		}

		this.minWaitPageLoadMs = options.minWaitPageLoadMs ?? 500;
		this.waitForNetworkIdleMs = options.waitForNetworkIdleMs ?? 1000;
		this.maxWaitPageLoadMs = options.maxWaitPageLoadMs ?? 5000;
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
	}

	get isConnected(): boolean {
		return this._isConnected;
	}

	get currentPage(): Page {
		if (!this._currentPage) {
			throw new ViewportCrashedError('No active page');
		}
		return this._currentPage;
	}

	get browserContext(): BrowserContext {
		if (!this.context) {
			throw new ViewportCrashedError('No active browser context');
		}
		return this.context;
	}

	get cdp(): CDPSession | null {
		return this.cdpSession;
	}

	// ── Lifecycle ──

	async start(): Promise<void> {
		const { durationMs } = await timed('browser-session.start', async () => {
			try {
				logger.info('Starting browser session');

				if (this.options.wsEndpoint) {
					logger.debug(`Connecting via WebSocket: ${this.options.wsEndpoint}`);
					this.browser = await chromium.connect(this.options.wsEndpoint);
				} else if (this.options.cdpUrl) {
					logger.debug(`Connecting via CDP: ${this.options.cdpUrl}`);
					this.browser = await chromium.connectOverCDP(this.options.cdpUrl);
				} else {
					this.browser = await this.launchBrowser();
				}

				const contexts = this.browser.contexts();
				if (contexts.length > 0) {
					this.context = contexts[0];
					logger.debug('Reusing existing browser context');
				} else {
					this.context = await this.createContext();
					logger.debug('Created new browser context');
				}

				const pages = this.context.pages();
				if (pages.length > 0) {
					this._currentPage = pages[0];
				} else {
					this._currentPage = await this.context.newPage();
				}

				// Create CDP session
				this.cdpSession = await this._currentPage.context().newCDPSession(this._currentPage);

				this._isConnected = true;

				// Wire up disconnect detection on the browser
				this.setupDisconnectHandler();

				// Discover initial targets
				await this.refreshTargets();

				// Detect initial viewport via CDP
				this.cachedViewport = null;
				await this.detectViewport();

				// Initialize watchdogs
				await this.initializeWatchdogs();

				// Set up page lifecycle listeners on the context
				this.setupPageLifecycleListeners();

				const pageUrl = this._currentPage.url();
				const pageTitle = await this._currentPage.title();

				// Emit initial lifecycle events
				this.eventBus.emit('content-ready', undefined as any);

				if (!isNewTabPage(pageUrl)) {
					this.eventBus.emit('page-ready', { url: pageUrl });
				}

				this.eventBus.emit('viewport-state', {
					url: pageUrl,
					title: pageTitle,
					tabCount: this.context.pages().length,
				});

				logger.info(`Browser session started: ${pageUrl}`);
			} catch (error) {
				throw new LaunchFailedError(
					`Failed to start browser: ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error instanceof Error ? error : undefined },
				);
			}
		});

		logger.debug(`start() completed in ${durationMs.toFixed(1)}ms`);
	}

	private setupDisconnectHandler(): void {
		if (!this.browser) return;

		this.browser.on('disconnected', () => {
			logger.warn('Browser disconnected');
			this._isConnected = false;
			this.eventBus.emit('crash', { reason: 'Browser disconnected unexpectedly' });
		});
	}

	private setupPageLifecycleListeners(): void {
		if (!this.context) return;

		// Track new pages (tabs) being created
		this.context.on('page', async (page: Page) => {
			const url = page.url();
			logger.debug(`New page created: ${url}`);
			this.eventBus.emit('tab-opened', { url });

			// Refresh target list when new pages appear
			await this.refreshTargets();

			// Emit browser-state update
			try {
				this.eventBus.emit('viewport-state', {
					url: this._currentPage?.url() ?? url,
					title: this._currentPage ? await this._currentPage.title() : '',
					tabCount: this.context?.pages().length ?? 1,
				});
			} catch {
				// Page might be closed already
			}

			// When the new page loads, emit page-loaded
			page.on('load', () => {
