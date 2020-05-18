import { Page } from 'playwright';
import { CommandResult } from '../types';
import { createLogger } from '../logging';
import { sleep } from '../utils';

const logger = createLogger('cmd:scroll');

export async function scroll(
  page: Page,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 300,
): Promise<CommandResult> {
  const start = Date.now();

  logger.debug(`scroll: ${direction} by ${amount}px`);

  const scrollMap: Record<string, { x: number; y: number }> = {
    up: { x: 0, y: -amount },
    down: { x: 0, y: amount },
    left: { x: -amount, y: 0 },
    right: { x: amount, y: 0 },
  };

  const { x, y } = scrollMap[direction];

  await page.evaluate(
    ([dx, dy]) => { window.scrollBy(dx, dy); },
    [x, y] as [number, number],
  );

  await sleep(200);

  const scrollPos = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));

  return {
    success: true,
    message: `Scrolled ${direction} by ${amount}px. Position: (${scrollPos.x}, ${scrollPos.y})`,
    data: scrollPos,
    duration: Date.now() - start,
  };
}
