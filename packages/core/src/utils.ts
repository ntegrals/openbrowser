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
