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

	browserBinary(path: string): this {
		this.options.browserBinaryPath = path;
		return this;
	}

	persistAfterClose(value = true): this {
		this.options.persistAfterClose = value;
		return this;
	}

	channel(name: string): this {
		this.options.channelName = name;
		return this;
	}

	extraArgs(...args: string[]): this {
		this.options.extraArgs = [...(this.options.extraArgs ?? []), ...args];
		return this;
	}

	stealthMode(value = true): this {
		this._stealthMode = value;
		return this;
	}

	dockerMode(value = true): this {
		this._dockerMode = value;
		return this;
	}

	deterministicRendering(value = true): this {
		this._deterministicRendering = value;
		return this;
	}

	downloadsPath(path: string): this {
		this._downloadsPath = path;
		return this;
	}

	maxIframes(max: number): this {
		this._maxIframes = max;
		return this;
	}

	addExtension(extensionPath: string): this {
		this._extensions.push(extensionPath);
		return this;
	}

	/**
	 * Auto-detect and apply Docker settings if running inside a container.
	 */
	autoDetect(): this {
		if (Config.isDocker()) {
			this._dockerMode = true;
			// Force headless in Docker if no display
			if (!Config.hasDisplay()) {
				this.options.headless = true;
			}
		}
		return this;
	}

	build(): LaunchOptions {
		const args = [...CHROME_AUTOMATION_FLAGS];

		// Disabled components
		args.push(`--disable-component-extensions-with-background-pages`);
		args.push(`--disable-features=${CHROME_STRIPPED_FEATURES.join(',')}`);

		// Mode-specific args
		if (this._stealthMode) {
			args.push(...ANTI_DETECTION_FLAGS);
		}

		if (this._dockerMode) {
			args.push(...CONTAINER_FLAGS);
		}

		if (this._deterministicRendering) {
			args.push(...REPRODUCIBLE_RENDER_FLAGS);
		}

		if (this.options.relaxedSecurity) {
			args.push(...RELAXED_SECURITY_FLAGS);
		}

		// Window size
		const width = this.options.windowWidth ?? 1280;
		const height = this.options.windowHeight ?? 1100;
		args.push(`--window-size=${width},${height}`);

		// Extensions
		if (this._extensions.length > 0) {
			args.push(`--load-extension=${this._extensions.join(',')}`);
		}

		// Downloads
		if (this._downloadsPath) {
			args.push(`--download-default-directory=${this._downloadsPath}`);
		}

		// User extra args (last, so they can override)
		if (this.options.extraArgs) {
			args.push(...this.options.extraArgs);
		}

		return {
			headless: this.options.headless ?? true,
			relaxedSecurity: this.options.relaxedSecurity ?? false,
			extraArgs: args,
			windowWidth: width,
			windowHeight: height,
			proxy: this.options.proxy,
			userDataDir: this.options.userDataDir,
			browserBinaryPath: this.options.browserBinaryPath,
			persistAfterClose: this.options.persistAfterClose ?? false,
			channelName: this.options.channelName,
		};
	}
}
