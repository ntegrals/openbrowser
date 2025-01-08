import type { LaunchOptions } from './types.js';
import { Config } from '../config/config.js';

/**
 * Chrome default args for automation — standard flags to disable
 * background noise, throttling, and other non-essential features.
 */
export const CHROME_AUTOMATION_FLAGS = [
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-background-networking',
	'--disable-background-timer-throttling',
	'--disable-backgrounding-occluded-windows',
	'--disable-breakpad',
	'--disable-component-update',
	'--disable-default-apps',
	'--disable-dev-shm-usage',
	'--disable-extensions-except=',
	'--disable-hang-monitor',
	'--disable-ipc-flooding-protection',
	'--disable-popup-blocking',
	'--disable-prompt-on-repost',
	'--disable-renderer-backgrounding',
	'--disable-sync',
	'--disable-translate',
	'--metrics-recording-only',
	'--no-pings',
	'--password-store=basic',
	'--use-mock-keychain',
	'--disable-blink-features=AutomationControlled',
	'--disable-infobars',
	'--disable-session-crashed-bubble',
	'--force-color-profile=srgb',
];

/**
 * Chrome disabled-components flag values that reduce resource usage
 * and prevent interfering background services.
 */
export const CHROME_STRIPPED_FEATURES = [
	'InterestFeedContentSuggestions',
	'Translate',
	'OptimizationHints',
	'MediaRouter',
	'DialMediaRouteProvider',
	'CalculatorTool',
	'CrashedTabFinder',
	'AutofillServerCommunication',
	'BackgroundTracing',
	'NtpTiles',
	'OneGoogleBar',
	'ReadLater',
	'NTPArticleSuggestions',
	'CrossDeviceSync',
	'PrivacySandboxSettings4',
	'SidePanelPinning',
	'HistoryEmbeddings',
	'PrivacySandboxPromptV2',
	'GlobalMediaControls',
	'ComposeService',
	'AutofillFeature',
	'NTPSigninPromo',
	'Prerender2',
	'TabGroupsSave',
];

export const ANTI_DETECTION_FLAGS = [
	'--disable-blink-features=AutomationControlled',
	'--disable-features=AutomationControlled',
];

export const CONTAINER_FLAGS = [
	'--no-sandbox',
	'--disable-gpu',
	'--disable-software-rasterizer',
	'--disable-setuid-sandbox',
	'--single-process',
];

export const RELAXED_SECURITY_FLAGS = [
	'--disable-web-security',
	'--disable-site-isolation-trials',
	'--disable-features=IsolateOrigins,site-per-process',
];

export const REPRODUCIBLE_RENDER_FLAGS = [
	'--deterministic-mode',
	'--disable-skia-runtime-opts',
	'--disable-font-subpixel-positioning',
	'--force-color-profile=srgb',
	'--disable-lcd-text',
];

/**
 * Builder pattern for browser profile configuration.
 * Replaces the Python ViewportConfig with a fluent API.
 */
export class LaunchProfile {
	private options: Partial<LaunchOptions> = {};
	private _stealthMode = false;
	private _dockerMode = false;
	private _deterministicRendering = false;
	private _maxIframes = 3;
	private _downloadsPath?: string;
	private _extensions: string[] = [];

	static create(): LaunchProfile {
		return new LaunchProfile();
	}

	headless(value = true): this {
		this.options.headless = value;
		return this;
	}

	relaxedSecurity(value = true): this {
		this.options.relaxedSecurity = value;
		return this;
	}

	windowSize(width: number, height: number): this {
		this.options.windowWidth = width;
		this.options.windowHeight = height;
		return this;
	}

	proxy(server: string, username?: string, password?: string): this {
		this.options.proxy = { server, username, password };
		return this;
	}

	userDataDir(dir: string): this {
		this.options.userDataDir = dir;
		return this;
	}
