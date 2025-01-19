import type { Message } from '../../model/messages.js';
import type { ContentPart } from '../../model/messages.js';

/**
 * Rough token estimation: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(content: string | unknown[]): number {
	if (typeof content === 'string') {
		return estimateTokens(content);
	}

	let total = 0;
	for (const part of content) {
		if (typeof part === 'object' && part !== null) {
			const p = part as Record<string, unknown>;
			if (p.type === 'text' && typeof p.text === 'string') {
				total += estimateTokens(p.text);
			} else if (p.type === 'image') {
				total += 1000; // Approximate cost for an image
			}
		}
	}
	return total;
}

// ── Sensitive Data Filtering ──

const MASK = '***';

/**
 * Replace all occurrences of each sensitive value in `text` with a mask.
 * Keys are used only for logging context; values are the secrets to redact.
 */
export function redactSensitiveValues(
	text: string,
	maskedValues: Record<string, string>,
): string {
	let result = text;
	for (const [_key, value] of Object.entries(maskedValues)) {
		if (!value) continue;
		// Escape regex special characters in the value
		const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		result = result.replace(new RegExp(escaped, 'g'), MASK);
	}
	return result;
}
