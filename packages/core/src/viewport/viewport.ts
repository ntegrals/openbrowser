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
