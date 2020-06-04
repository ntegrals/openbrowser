import { Page } from 'playwright';
import { CommandResult } from '../types';
import { CommandError, ElementNotFoundError } from '../errors';
import { createLogger } from '../logging';

const logger = createLogger('cmd:keyboard');

export async function pressKey(page: Page, key: string): Promise<CommandResult> {
  const start = Date.now();
  logger.debug(`pressKey: ${key}`);
  try {
    await page.keyboard.press(key);
    return { success: true, message: `Pressed key: ${key}`, duration: Date.now() - start };
  } catch (err) {
    throw new CommandError('pressKey', err instanceof Error ? err.message : String(err));
  }
}

export async function goBack(page: Page, options: { timeout?: number } = {}): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 30000 } = options;
  logger.debug('goBack');
  try {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout });
    return { success: true, message: `Navigated back to ${page.url()}`, data: { url: page.url() }, duration: Date.now() - start };
  } catch (err) {
    throw new CommandError('goBack', err instanceof Error ? err.message : String(err));
  }
}

export async function goForward(page: Page, options: { timeout?: number } = {}): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 30000 } = options;
  logger.debug('goForward');
  try {
    await page.goForward({ waitUntil: 'domcontentloaded', timeout });
    return { success: true, message: `Navigated forward to ${page.url()}`, data: { url: page.url() }, duration: Date.now() - start };
  } catch (err) {
    throw new CommandError('goForward', err instanceof Error ? err.message : String(err));
  }
}

export async function hover(page: Page, selector: string, options: { timeout?: number } = {}): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 5000 } = options;
  logger.debug(`hover: ${selector}`);
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
    await page.hover(selector);
    return { success: true, message: `Hovered over ${selector}`, duration: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('waiting for selector')) throw new ElementNotFoundError(selector);
    throw new CommandError('hover', message);
  }
}

export async function selectOption(page: Page, selector: string, value: string, options: { timeout?: number } = {}): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 5000 } = options;
  logger.debug(`select: "${value}" from ${selector}`);
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
    await page.selectOption(selector, value);
    return { success: true, message: `Selected "${value}" from ${selector}`, duration: Date.now() - start };
  } catch (err) {
    throw new CommandError('select', err instanceof Error ? err.message : String(err));
  }
}

export async function waitForNavigation(page: Page, options: { timeout?: number } = {}): Promise<CommandResult> {
  const start = Date.now();
  const { timeout = 30000 } = options;
  logger.debug('waitForNavigation');
  try {
    await page.waitForLoadState('domcontentloaded', { timeout });
    return { success: true, message: `Navigation complete: ${page.url()}`, data: { url: page.url() }, duration: Date.now() - start };
  } catch (err) {
    throw new CommandError('waitForNavigation', err instanceof Error ? err.message : String(err));
  }
}
