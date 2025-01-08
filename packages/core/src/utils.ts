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
