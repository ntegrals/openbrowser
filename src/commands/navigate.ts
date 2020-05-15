import { Page } from 'playwright';
import { CommandResult } from '../types';
import { CommandError } from '../errors';
import { createLogger } from '../logging';

const logger = createLogger('cmd:navigate');

export async function navigate(
  page: Page,
  url: string,
  options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'; timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;

  logger.debug(`navigate: ${url}`);

  try {
    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      targetUrl = `https://${url}`;
    }

    await page.goto(targetUrl, { waitUntil, timeout });

    const finalUrl = page.url();
    const title = await page.title();

    return {
      success: true,
      message: `Navigated to ${finalUrl} ("${title}")`,
      data: { url: finalUrl, title },
      duration: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CommandError('navigate', message);
  }
}
