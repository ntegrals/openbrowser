import { Page } from 'puppeteer';
import { CommandResult, ScreenshotData, Position } from './types';
import { CommandError, ElementNotFoundError } from './errors';
import { createLogger } from './logging';
import { sleep, withTimeout } from './utils';

const logger = createLogger('commands');

/**
 * Click on an element identified by a CSS selector.
 */
export async function click(
  page: Page,
  selector: string,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const timeout = options.timeout ?? 5000;

  logger.debug(`click: ${selector}`);

  try {
    // Wait for the element to be present and visible
    await page.waitForSelector(selector, {
      visible: true,
      timeout,
    });

    await page.click(selector);

    // Short wait for any resulting actions
    await sleep(100);

    return {
      success: true,
      message: `Clicked ${selector}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('No element found') || message.includes('waiting for selector')) {
      throw new ElementNotFoundError(selector);
    }
    throw new CommandError('click', message);
  }
}

/**
 * Type text into an input element.
 */
export async function typeText(
  page: Page,
  selector: string,
  text: string,
  options: { clearFirst?: boolean; delay?: number; timeout?: number } = {},
