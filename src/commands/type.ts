import { Page } from 'playwright';
import { CommandResult } from '../types';
import { CommandError, ElementNotFoundError } from '../errors';
import { createLogger } from '../logging';
import { sleep } from '../utils';

const logger = createLogger('cmd:type');

export async function typeText(
  page: Page,
  selector: string,
  text: string,
  options: { clearFirst?: boolean; delay?: number; timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { clearFirst = true, delay = 0, timeout = 5000 } = options;

  logger.debug(`type: "${text}" into ${selector}`);

  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });

    if (clearFirst) {
      await page.fill(selector, '');
      await sleep(50);
    }

    if (delay > 0) {
      await page.type(selector, text, { delay });
    } else {
      await page.fill(selector, text);
    }

    return {
      success: true,
      message: `Typed "${text.slice(0, 30)}${text.length > 30 ? '...' : ''}" into ${selector}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('waiting for selector')) {
      throw new ElementNotFoundError(selector);
    }
    throw new CommandError('type', message);
  }
}
