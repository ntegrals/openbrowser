import { nanoid } from 'nanoid';

// ── ID generation ──

export function generateId(size = 12): string {
	return nanoid(size);
}

// ── URL matching ──

export function matchesUrlPattern(url: string, pattern: string): boolean {
	if (pattern === '*') return true;

	try {
		const urlObj = new URL(url);
		const patternObj = new URL(pattern.includes('://') ? pattern : `https://${pattern}`);

		if (patternObj.hostname.startsWith('*.')) {
			const baseDomain = patternObj.hostname.slice(2);
			if (!urlObj.hostname.endsWith(baseDomain) && urlObj.hostname !== baseDomain) {
				return false;
			}
		} else if (urlObj.hostname !== patternObj.hostname) {
			return false;
		}

		if (patternObj.pathname !== '/' && patternObj.pathname !== '/*') {
			const patternPath = patternObj.pathname.replace(/\*/g, '.*');
			const regex = new RegExp(`^${patternPath}`);
			if (!regex.test(urlObj.pathname)) {
				return false;
			}
		}

		return true;
	} catch {
		return url.includes(pattern);
	}
}

export function isUrlPermitted(
	url: string,
	allowedUrls?: string[],
	blockedUrls?: string[],
): boolean {
	if (blockedUrls?.some((pattern) => matchesUrlPattern(url, pattern))) {
		return false;
	}
	if (allowedUrls && allowedUrls.length > 0) {
		return allowedUrls.some((pattern) => matchesUrlPattern(url, pattern));
	}
	return true;
}

// ── Text utilities ──

export function sanitizeText(text: string): string {
	return text
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function truncateText(text: string, maxLength: number, suffix = '...'): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - suffix.length) + suffix;
}

export function removeTags(html: string): string {
	return html.replace(/<[^>]*>/g, '');
}

// ── Timing ──

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDeadline<T>(
	promise: Promise<T>,
	ms: number,
	message = 'Operation timed out',
): Promise<T> {
	const timer = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error(message)), ms),
	);
	return Promise.race([promise, timer]);
}

export class Timer {
	private startTime: number;

	constructor() {
		this.startTime = Date.now();
	}

	elapsed(): number {
		return Date.now() - this.startTime;
	}

	elapsedSeconds(): number {
		return this.elapsed() / 1000;
	}

	reset(): void {
		this.startTime = Date.now();
	}
}

// ── Retry ──

export interface RetryOptions {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffFactor: number;
}

const DEFAULT_RETRY: RetryOptions = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	backoffFactor: 2,
};

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: Partial<RetryOptions> = {},
): Promise<T> {
	const opts = { ...DEFAULT_RETRY, ...options };
	let lastError: Error | undefined;
	let delay = opts.initialDelayMs;

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < opts.maxRetries) {
				await sleep(Math.min(delay, opts.maxDelayMs));
				delay *= opts.backoffFactor;
			}
		}
	}

	throw lastError;
}

// ── Misc ──

export function groupBy<T, K extends string | number>(
	items: T[],
	keyFn: (item: T) => K,
): Record<K, T[]> {
	return items.reduce(
		(acc, item) => {
			const key = keyFn(item);
			(acc[key] ??= []).push(item);
			return acc;
		},
		{} as Record<K, T[]>,
	);
}

export function dedent(str: string): string {
	const lines = str.split('\n');
	if (lines[0]?.trim() === '') lines.shift();
	if (lines[lines.length - 1]?.trim() === '') lines.pop();

	const minIndent = lines
		.filter((line) => line.trim().length > 0)
		.reduce((min, line) => {
			const match = line.match(/^(\s*)/);
			return Math.min(min, match ? match[1].length : 0);
		}, Number.POSITIVE_INFINITY);

	if (minIndent === Number.POSITIVE_INFINITY) return str;
	return lines.map((line) => line.slice(minIndent)).join('\n');
}

// ── URL utilities ──

/**
 * Match a URL against a domain pattern like "*.example.com" or "example.com/path/*".
 * More comprehensive than matchesUrlPattern — handles port stripping, www normalization.
 */
export function matchUrlWithDomainPattern(url: string, pattern: string): boolean {
	try {
		const urlObj = new URL(url);
		const urlHost = urlObj.hostname.replace(/^www\./, '');

		// Pattern can be a plain domain, wildcard domain, or full URL pattern
		if (pattern.startsWith('*.')) {
			const base = pattern.slice(2);
			return urlHost === base || urlHost.endsWith(`.${base}`);
		}

		// Try parsing as URL
		const patternHost = pattern.includes('://')
			? new URL(pattern).hostname.replace(/^www\./, '')
			: pattern.replace(/^www\./, '').split('/')[0];

		return urlHost === patternHost;
	} catch {
		return url.includes(pattern);
	}
}

const NEW_TAB_URLS = new Set([
	'about:blank',
	'about:newtab',
	'chrome://newtab/',
	'chrome://new-tab-page/',
	'edge://newtab/',
	'about:home',
]);

export function isNewTabPage(url: string): boolean {
	return NEW_TAB_URLS.has(url) || url === '' || url === 'about:blank';
}

/**
 * Remove unpaired surrogates from a string to prevent JSON serialization issues.
 */
export function sanitizeSurrogates(text: string): string {
	return text.replace(
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
		'\uFFFD',
	);
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

/**
 * Extract all URLs from a text string.
 */
export function extractUrls(text: string): string[] {
	return [...text.matchAll(URL_REGEX)].map((m) => m[0]);
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
