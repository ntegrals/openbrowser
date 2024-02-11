import { Page } from 'playwright';
import { CommandResult } from '../../types';
import { createLogger } from '../../logging';

const logger = createLogger('cmd:extract');

/**
 * Extract text content from the page or a specific element.
 */
export async function extract(
  page: Page,
  options: { selector?: string } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { selector } = options;

  logger.debug(`extract: ${selector ?? 'full page'}`);

  try {
    let text: string;
    if (selector) {
      text = await page.$eval(selector, (el) => (el as HTMLElement).innerText || el.textContent || '');
    } else {
      text = await page.evaluate(() => document.body?.innerText || '');
    }

    return {
      success: true,
      message: `Extracted ${text.length} characters`,
      data: text.trim(),
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      message: `Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      duration: Date.now() - start,
    };
  }
}
