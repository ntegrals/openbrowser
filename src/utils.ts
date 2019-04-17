import * as crypto from 'crypto';

/**
 * Generate a random ID string.
 */
export function generateId(length: number = 12): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize text by removing control characters and collapsing whitespace.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Truncate text to a maximum length with an ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Strip HTML tags from a string.
 */
export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
