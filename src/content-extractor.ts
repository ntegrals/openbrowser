import { Page } from 'playwright';
import TurndownService from 'turndown';
import { createLogger } from './logging';
import { sanitizeText, truncateText } from './utils';

const logger = createLogger('content-extractor');

/**
 * Extract readable text content from a page.
 * Strips navigation, footers, and non-content elements.
 */
export async function extractPageContent(
  page: Page,
  options: { maxLength?: number; includeLinks?: boolean } = {},
): Promise<string> {
  const { maxLength = 50000, includeLinks = false } = options;

  const content = await page.evaluate((includeLinks: boolean) => {
    // Remove non-content elements
    const removeSelectors = [
      'script', 'style', 'noscript', 'nav', 'header', 'footer',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '.cookie-banner', '.popup', '.modal', '.overlay',
    ];

    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const sel of removeSelectors) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }

    let text = clone.innerText || '';

    if (includeLinks) {
      const links = document.querySelectorAll('a[href]');
      const linkTexts: string[] = [];
      links.forEach(a => {
        const href = a.getAttribute('href');
        const label = (a.textContent || '').trim();
        if (href && label && !href.startsWith('#') && !href.startsWith('javascript:')) {
          linkTexts.push(`[${label}](${href})`);
        }
      });
      if (linkTexts.length > 0) {
        text += '\n\nLinks:\n' + linkTexts.join('\n');
      }
    }

    return text;
  }, includeLinks);

  const cleaned = sanitizeText(content);
  return truncateText(cleaned, maxLength);
}

/**
 * Extract the page title.
 */
export async function extractTitle(page: Page): Promise<string> {
  return page.title();
}

/**
 * Extract meta description.
 */
export async function extractMetaDescription(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[name="description"]');
    return meta ? meta.getAttribute('content') : null;
  });
}
