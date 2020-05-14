import { Page } from 'playwright';
import { CommandResult } from '../types';
import { CommandError, ElementNotFoundError } from '../errors';
import { createLogger } from '../logging';
import { sleep } from '../utils';

const logger = createLogger('cmd:click');

export async function click(
  page: Page,
  selector: string,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const timeout = options.timeout ?? 5000;

  logger.debug(`click: ${selector}`);

  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
    await page.click(selector);
    await sleep(100);

    return {
      success: true,
      message: `Clicked ${selector}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('waiting for selector')) {
      throw new ElementNotFoundError(selector);
    }
    throw new CommandError('click', message);
  }
}
