import { Page } from 'playwright';
import { ScreenshotData } from '../types';
import { createLogger } from '../logging';

const logger = createLogger('cmd:screenshot');

export async function screenshot(
  page: Page,
  options: { fullPage?: boolean } = {},
): Promise<ScreenshotData> {
  const { fullPage = false } = options;

  logger.debug(`screenshot: fullPage=${fullPage}`);

  const buffer = await page.screenshot({
    fullPage,
    type: 'png',
  });

  const viewport = page.viewportSize();

  return {
    buffer: Buffer.from(buffer),
    width: viewport?.width ?? 1280,
    height: viewport?.height ?? 800,
  };
}
