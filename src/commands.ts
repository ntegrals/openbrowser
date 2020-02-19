import { Page } from 'playwright';
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
): Promise<CommandResult> {
  const start = Date.now();
  const { clearFirst = true, delay = 0, timeout = 5000 } = options;

  logger.debug(`type: "${text}" into ${selector}`);

  try {
    await page.waitForSelector(selector, { visible: true, timeout });

    if (clearFirst) {
      // Triple-click to select all, then type over it
      await page.click(selector, { clickCount: 3 });
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
    if (message.includes('No element found') || message.includes('waiting for selector')) {
      throw new ElementNotFoundError(selector);
    }
    throw new CommandError('type', message);
  }
}

/**
 * Navigate to a URL.
 */
export async function navigate(
  page: Page,
  url: string,
  options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'; timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;

  logger.debug(`navigate: ${url}`);

  try {
    // Normalize the URL
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

/**
 * Scroll the page in a given direction.
 */
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
    (dx: number, dy: number) => {
      window.scrollBy(dx, dy);
    },
    x,
    y,
  );

  // Wait briefly for any lazy-loaded content
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

/**
 * Take a screenshot of the current page.
 */
export async function screenshot(
  page: Page,
  options: { fullPage?: boolean; quality?: number } = {},
): Promise<ScreenshotData> {
  const start = Date.now();
  const { fullPage = false, quality } = options;

  logger.debug(`screenshot: fullPage=${fullPage}`);

  const buffer = await page.screenshot({
    fullPage,
    type: 'png',
    ...(quality !== undefined ? { quality } : {}),
  }) as Buffer;

  const viewport = page.viewport();

  return {
    buffer,
    width: viewport?.width ?? 1280,
    height: viewport?.height ?? 800,
  };
}

/**
 * Go back to the previous page in history.
 */
export async function goBack(
  page: Page,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 30000 } = options;

  logger.debug('goBack');

  try {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout });
    const url = page.url();
    return {
      success: true,
      message: `Navigated back to ${url}`,
      data: { url },
      duration: Date.now() - start,
    };
  } catch (err) {
    throw new CommandError('goBack', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Go forward to the next page in history.
 */
export async function goForward(
  page: Page,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 30000 } = options;

  logger.debug('goForward');

  try {
    await page.goForward({ waitUntil: 'domcontentloaded', timeout });
    const url = page.url();
    return {
      success: true,
      message: `Navigated forward to ${url}`,
      data: { url },
      duration: Date.now() - start,
    };
  } catch (err) {
    throw new CommandError('goForward', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Press a keyboard key.
 */
export async function pressKey(
  page: Page,
  key: string,
): Promise<CommandResult> {
  const start = Date.now();

  logger.debug(`pressKey: ${key}`);

  try {
    await page.keyboard.press(key);
    return {
      success: true,
      message: `Pressed key: ${key}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    throw new CommandError('pressKey', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Hover over an element.
 */
export async function hover(
  page: Page,
  selector: string,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 5000 } = options;

  logger.debug(`hover: ${selector}`);

  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    await page.hover(selector);

    return {
      success: true,
      message: `Hovered over ${selector}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('No element found') || message.includes('waiting for selector')) {
      throw new ElementNotFoundError(selector);
    }
    throw new CommandError('hover', message);
  }
}

/**
 * Select an option from a <select> element.
 */
export async function selectOption(
  page: Page,
  selector: string,
  value: string,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 5000 } = options;

  logger.debug(`select: "${value}" from ${selector}`);

  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    await page.select(selector, value);

    return {
      success: true,
      message: `Selected "${value}" from ${selector}`,
      duration: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CommandError('select', message);
  }
}

/**
 * Wait for navigation to complete (e.g., after clicking a link).
 */
export async function waitForNavigation(
  page: Page,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 30000 } = options;

  logger.debug('waitForNavigation');

  try {
    await page.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout,
    });

    const url = page.url();
    return {
      success: true,
      message: `Navigation complete: ${url}`,
      data: { url },
      duration: Date.now() - start,
    };
  } catch (err) {
    throw new CommandError(
      'waitForNavigation',
      err instanceof Error ? err.message : String(err),
    );
  }
}
