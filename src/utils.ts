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

/**
 * Create a promise that rejects after a timeout.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message?: string,
): Promise<T> {
  const timer = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(message || `Timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timer]);
}

/**
 * Simple debounce function.
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number,
): T {
  let timer: NodeJS.Timeout | undefined;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T;
}

/**
 * Check if a URL is valid.
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a URL by ensuring it has a protocol.
 */
/**
 * Retry a function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await sleep(delayMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

export function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}
