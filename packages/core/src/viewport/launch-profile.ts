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
