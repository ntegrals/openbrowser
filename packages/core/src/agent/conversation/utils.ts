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

/**
 * Deep-filter a Message, masking any sensitive values found in text content.
 * Returns a new message (does not mutate the original).
 */
export function redactMessage(
	message: Message,
	maskedValues: Record<string, string>,
): Message {
	const entries = Object.entries(maskedValues);
	if (entries.length === 0) return message;

	const content = message.content;

	if (typeof content === 'string') {
		return {
			...message,
			content: redactSensitiveValues(content, maskedValues),
		} as Message;
	}

	if (Array.isArray(content)) {
		const filtered = (content as ContentPart[]).map((part) => {
			if (part.type === 'text') {
				return {
					...part,
					text: redactSensitiveValues(part.text, maskedValues),
				};
			}
			// Images are left as-is (binary data)
			return part;
		});
		return {
			...message,
			content: filtered,
		} as Message;
	}

	return message;
}

/**
 * Filter an array of Messages, masking sensitive data in each.
 */
export function redactMessages(
	messages: Message[],
	maskedValues: Record<string, string>,
): Message[] {
	if (Object.keys(maskedValues).length === 0) return messages;
	return messages.map((m) => redactMessage(m, maskedValues));
}

/**
 * Extract the text content from a Message as a plain string.
 * For multi-part content, concatenates all text parts.
 */
export function extractTextContent(message: Message): string {
	const content = message.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return (content as ContentPart[])
			.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
			.map((p) => p.text)
			.join('\n');
	}
	return '';
}

/**
 * Truncate a string to maxLen characters, appending an ellipsis if truncated.
 */
export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}
