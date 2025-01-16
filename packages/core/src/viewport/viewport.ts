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
				const loadedUrl = page.url();
				if (!isNewTabPage(loadedUrl)) {
					logger.debug(`Page loaded in new tab: ${loadedUrl}`);
				}
			});
		});
	}

	// ── Multi-target tracking ──

	/**
	 * Queries CDP for the current list of targets (pages, iframes, workers, etc.)
	 * and updates the internal target map.
	 */
	async getTargets(): Promise<Target[]> {
		await this.refreshTargets();
		return Array.from(this.knownTargets.values());
	}

	private async refreshTargets(): Promise<void> {
		if (!this.cdpSession) return;

		try {
			const result = await (
				this.cdpSession.send('Target.getTargets') as Promise<unknown>
			) as Promise<{ targetInfos: Array<{ targetId: string; type: string; url: string; title: string }> }>;

			const { targetInfos } = await result;

			this.knownTargets.clear();
			for (const info of targetInfos) {
				const type = normalizeTargetType(info.type);
				this.knownTargets.set(info.targetId, {
					targetId: targetId(info.targetId),
					type,
					url: info.url,
					title: info.title,
				});
			}

			logger.debug(`Refreshed targets: ${this.knownTargets.size} found`);
		} catch (error) {
			logger.debug(
				`Failed to refresh targets: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Find a target by its targetId.
	 */
	findTarget(id: TargetId): Target | undefined {
		return this.knownTargets.get(id);
	}

	/**
	 * Get only page-type targets, filtering out new-tab pages.
	 */
	async getPageTargets(): Promise<Target[]> {
		const targets = await this.getTargets();
		return targets.filter((t) => t.type === 'page' && !isNewTabPage(t.url));
	}

	// ── Viewport detection via CDP ──

	/**
	 * Detects the actual viewport dimensions by evaluating JavaScript in the page
	 * via CDP Runtime.evaluate. This is more accurate than Playwright's viewportSize()
	 * because it reflects the real rendered viewport including device pixel ratio.
	 */
	async detectViewport(): Promise<ViewportInfo> {
		if (this.cachedViewport) {
			return this.cachedViewport;
		}

		if (!this.cdpSession) {
			// Fallback to launch options if no CDP session
			const fallback: ViewportInfo = {
				width: this.launchOptions.windowWidth,
				height: this.launchOptions.windowHeight,
				deviceScaleFactor: 1,
				isMobile: false,
			};
			this.cachedViewport = fallback;
			return fallback;
		}

		try {
			const { result: viewportResult } = await timed('detectViewport', async () => {
				const evalResult = await (
					this.cdpSession!.send('Runtime.evaluate', {
						expression: `JSON.stringify({
							width: window.innerWidth,
							height: window.innerHeight,
							deviceScaleFactor: window.devicePixelRatio || 1,
							isMobile: /Mobi|Android/i.test(navigator.userAgent)
						})`,
						returnByValue: true,
					}) as Promise<unknown>
				) as Promise<{ result: { value: string } }>;
				return evalResult;
			});

			const parsed = JSON.parse(viewportResult.result.value) as ViewportInfo;
			this.cachedViewport = parsed;
			logger.debug(
				`Viewport detected: ${parsed.width}x${parsed.height} @${parsed.deviceScaleFactor}x`,
			);
			return parsed;
		} catch (error) {
			logger.warn(
				`Viewport detection failed, using defaults: ${error instanceof Error ? error.message : String(error)}`,
			);
			const fallback: ViewportInfo = {
				width: this.launchOptions.windowWidth,
				height: this.launchOptions.windowHeight,
				deviceScaleFactor: 1,
				isMobile: false,
			};
			this.cachedViewport = fallback;
			return fallback;
		}
	}

	/** Invalidates the cached viewport, forcing a fresh CDP detection on next access. */
	invalidateViewportCache(): void {
		this.cachedViewport = null;
	}

	// ── Reconnection logic ──

	/**
	 * Attempts to reconnect to the browser after a disconnect. Uses the original
	 * connection method (wsEndpoint, cdpUrl, or local launch). Retries up to
	 * maxReconnectAttempts with exponential backoff.
	 *
	 * Returns true if reconnection succeeded, false otherwise.
	 */
	async reconnect(): Promise<boolean> {
		if (this.reconnecting) {
			logger.warn('Reconnection already in progress, skipping');
			return false;
		}

		this.reconnecting = true;
		logger.info('Attempting to reconnect browser session');

		try {
			// Clean up current state without emitting close event
			await this.cleanupForReconnect();

			let delay = this.reconnectDelayMs;

			for (let attempt = 1; attempt <= this.maxReconnectAttempts; attempt++) {
				logger.info(`Reconnect attempt ${attempt}/${this.maxReconnectAttempts}`);

				try {
					if (this.options.wsEndpoint) {
						this.browser = await chromium.connect(this.options.wsEndpoint);
					} else if (this.options.cdpUrl) {
						this.browser = await chromium.connectOverCDP(this.options.cdpUrl);
					} else {
						// For locally launched browsers, we need to launch a new instance
						this.browser = await this.launchBrowser();
					}

					// Re-establish context
					const contexts = this.browser.contexts();
					if (contexts.length > 0) {
						this.context = contexts[0];
					} else {
						this.context = await this.createContext();
					}

					// Re-establish page
					const pages = this.context.pages();
					if (pages.length > 0) {
						this._currentPage = pages[0];
					} else {
						this._currentPage = await this.context.newPage();
					}

					// Re-create CDP session
					this.cdpSession = await this._currentPage.context().newCDPSession(this._currentPage);

					this._isConnected = true;
					this.cachedViewport = null;

					// Re-wire handlers
					this.setupDisconnectHandler();
					this.setupPageLifecycleListeners();

					// Refresh targets after reconnect
					await this.refreshTargets();

					// Re-initialize watchdogs
					await this.initializeWatchdogs();

					logger.info(`Reconnected successfully on attempt ${attempt}`);

					// Emit lifecycle events for the reconnected state
					const url = this._currentPage.url();
					const title = await this._currentPage.title();

					this.eventBus.emit('viewport-state', {
						url,
						title,
						tabCount: this.context.pages().length,
					});

					return true;
				} catch (error) {
					logger.warn(
						`Reconnect attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
					);

					if (attempt < this.maxReconnectAttempts) {
						await new Promise((resolve) => setTimeout(resolve, delay));
						delay *= 2; // Exponential backoff
					}
				}
			}

			logger.error(`All ${this.maxReconnectAttempts} reconnect attempts failed`);
			this.eventBus.emit('crash', { reason: 'Reconnection failed after all attempts' });
			return false;
		} finally {
			this.reconnecting = false;
		}
	}

	/**
	 * Cleans up internal state in preparation for a reconnect attempt,
	 * without emitting lifecycle events or clearing the event bus.
	 */
	private async cleanupForReconnect(): Promise<void> {
		// Detach watchdogs
		for (const watchdog of this.watchdogs) {
			try {
				await watchdog.detach();
			} catch {
				// Ignore detach errors during reconnect
			}
		}
		this.watchdogs = [];

		// Detach CDP session
		if (this.cdpSession) {
			try {
				await this.cdpSession.detach();
			} catch {
				// Ignore
			}
			this.cdpSession = null;
		}

		// Don't close the browser if connecting remotely -- it's already disconnected
		if (this.browser && !this.options.wsEndpoint && !this.options.cdpUrl) {
			try {
				await this.browser.close();
			} catch {
				// Ignore
			}
		}

		this.browser = null;
		this.context = null;
		this._currentPage = null;
		this._isConnected = false;
		this.knownTargets.clear();
		this.cachedViewport = null;
	}

	// ── DOM stability ──

	/**
	 * Waits for the DOM to stop mutating. Uses a MutationObserver injected via
	 * page.evaluate to detect when no DOM changes occur for a quiet period.
	 *
	 * @param timeout - Maximum time to wait in ms (default: 3000)
	 * @param quietPeriodMs - How long the DOM must be silent to be considered stable (default: 300)
	 */
	async waitForStableDOM(timeout = 3000, quietPeriodMs = 300): Promise<void> {
		const page = this.currentPage;

		const { durationMs } = await timed('waitForStableDOM', async () => {
			try {
				await page.evaluate(
					({ timeoutMs, quietMs }) => {
						return new Promise<void>((resolve) => {
							let timer: ReturnType<typeof setTimeout>;
							let overallTimer: ReturnType<typeof setTimeout>;

							const observer = new MutationObserver(() => {
								clearTimeout(timer);
								timer = setTimeout(() => {
									observer.disconnect();
									clearTimeout(overallTimer);
									resolve();
								}, quietMs);
							});

							observer.observe(document.body, {
								childList: true,
								subtree: true,
								attributes: true,
								characterData: true,
							});

							// Start the quiet period timer immediately -- if no mutations
							// happen at all, we resolve after quietMs
							timer = setTimeout(() => {
								observer.disconnect();
								clearTimeout(overallTimer);
								resolve();
							}, quietMs);

							// Overall timeout: resolve even if mutations keep happening
							overallTimer = setTimeout(() => {
								observer.disconnect();
								clearTimeout(timer);
								resolve();
							}, timeoutMs);
						});
					},
					{ timeoutMs: timeout, quietMs: quietPeriodMs },
				);
			} catch (error) {
				// If the page navigated or was closed, just return
				logger.debug(
					`waitForStableDOM interrupted: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});

		logger.debug(`DOM stabilized in ${durationMs.toFixed(1)}ms`);
	}

	// ── Visible HTML extraction ──

	/**
	 * Returns the HTML of elements currently visible in the viewport.
	 * Uses IntersectionObserver logic evaluated in-page to collect only
	 * elements that are within the visible area, then serializes them.
	 */
	async getVisibleHtml(): Promise<string> {
		const page = this.currentPage;

		const { result: html } = await timed('getVisibleHtml', async () => {
			return page.evaluate(() => {
				function isInViewport(el: Element): boolean {
					const rect = el.getBoundingClientRect();
					// Element is at least partially visible
					return (
						rect.bottom > 0 &&
						rect.right > 0 &&
						rect.top < window.innerHeight &&
						rect.left < window.innerWidth &&
						rect.width > 0 &&
						rect.height > 0
					);
				}

				function isVisible(el: Element): boolean {
					const style = window.getComputedStyle(el);
					return (
						style.display !== 'none' &&
						style.visibility !== 'hidden' &&
						style.opacity !== '0' &&
						isInViewport(el)
					);
				}

				// Walk the DOM and collect visible top-level elements
				const visibleParts: string[] = [];
				const body = document.body;
				if (!body) return '<body></body>';

				// Collect direct children of body that are visible,
				// or recurse one level for major containers
				for (const child of Array.from(body.children)) {
					if (isVisible(child)) {
						// Clone the element and remove hidden descendants
						const clone = child.cloneNode(true) as Element;
						const hiddenDescendants = Array.from(clone.querySelectorAll('*')).filter(
							(desc) => {
								const s = window.getComputedStyle(desc);
								return s.display === 'none' || s.visibility === 'hidden';
							},
						);
						for (const hidden of hiddenDescendants) {
							hidden.remove();
						}
						visibleParts.push(clone.outerHTML);
					}
				}

				if (visibleParts.length === 0) {
					// Fallback: return the body's innerHTML truncated
					return body.innerHTML.slice(0, 50000);
				}

				return visibleParts.join('\n');
			});
		});

		return html;
	}

	// ── Launch & context setup (existing) ──

	private async launchBrowser(): Promise<Browser> {
		const args = this.buildChromiumArgs();

		logger.debug(`Launching chromium with ${args.length} args`);

		return chromium.launch({
			headless: this.launchOptions.headless,
			args,
			executablePath: this.launchOptions.browserBinaryPath || undefined,
			channel: this.launchOptions.channelName || undefined,
			proxy: this.launchOptions.proxy
				? {
						server: this.launchOptions.proxy.server,
						username: this.launchOptions.proxy.username,
