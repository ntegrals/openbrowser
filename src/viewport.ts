import puppeteer, { Browser, Page, LaunchOptions } from 'puppeteer';
import { ViewportConfig, createConfig, validateConfig } from './config';
import { EventHub } from './event-hub';
import { DomInspector } from './dom-inspector';
import * as commands from './commands';
import {
  LaunchFailedError,
  ViewportError,
  NavigationFailedError,
} from './errors';
import { createLogger } from './logging';
import { sleep, generateId } from './utils';
import { CommandResult, PageInfo, ScreenshotData, ViewportSize } from './types';

const logger = createLogger('viewport');

/**
 * Events emitted by the Viewport.
 */
export interface ViewportEvents {
  'launched': { headless: boolean };
  'page-loaded': { url: string; title: string };
  'navigated': { url: string; title: string };
  'command': { name: string; result: CommandResult };
  'error': { message: string; error?: Error };
  'closed': void;
}

/**
 * Viewport wraps a Puppeteer browser instance and provides a high-level
 * API for browser automation. It manages the browser lifecycle, page
 * navigation, and command execution.
 *
 * Usage:
 *   const viewport = new Viewport({ headless: true });
 *   await viewport.launch();
 *   await viewport.navigate('https://example.com');
 *   await viewport.click('button.submit');
 *   await viewport.close();
 */
export class Viewport {
  readonly id: string;
  readonly config: ViewportConfig;
  readonly events: EventHub<ViewportEvents>;
  readonly inspector: DomInspector;

  private browser: Browser | null = null;
  private _page: Page | null = null;
  private _isConnected = false;
  private _launchTime: number | null = null;

  constructor(options: Partial<ViewportConfig> = {}) {
    this.id = generateId(8);
    this.config = createConfig(options);
    validateConfig(this.config);
    this.events = new EventHub<ViewportEvents>();

    // Inspector will be initialized after launch
    this.inspector = null as any;
  }

  /**
   * Whether the browser is currently running and connected.
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * The underlying Puppeteer Page instance.
   * Throws if the browser hasn't been launched.
   */
  get page(): Page {
    if (!this._page) {
      throw new ViewportError('Browser not launched. Call launch() first.');
    }
    return this._page;
  }

  /**
   * How long (in ms) since the browser was launched.
   */
  get uptime(): number {
    if (!this._launchTime) return 0;
    return Date.now() - this._launchTime;
  }

  /**
   * Launch the browser.
   */
  async launch(): Promise<void> {
    if (this._isConnected) {
      logger.warn('Browser already launched');
      return;
    }

    logger.info(`Launching browser (headless: ${this.config.headless})`);

    try {
      const args = this.buildLaunchArgs();

      this.browser = await puppeteer.launch({
        headless: this.config.headless,
        args,
        executablePath: this.config.executablePath,
        userDataDir: this.config.userDataDir,
        defaultViewport: {
          width: this.config.viewport.width,
          height: this.config.viewport.height,
        },
      });

      this._page = await this.browser.newPage();
      this._isConnected = true;
      this._launchTime = Date.now();

      // Re-initialize the inspector with the page
      (this as any).inspector = new DomInspector(this._page);

      // Handle browser disconnection
      this.browser.on('disconnected', () => {
        logger.warn('Browser disconnected');
        this._isConnected = false;
        this.events.emit('error', {
          message: 'Browser disconnected unexpectedly',
        });
      });

      // Handle page errors
      this._page.on('error', (err) => {
        logger.error('Page error:', err);
        this.events.emit('error', { message: err.message, error: err });
      });

      this._page.on('pageerror', (err) => {
        logger.debug(`Page JS error: ${err.message}`);
      });

      this.events.emit('launched', { headless: this.config.headless });

      logger.info(`Browser launched (id: ${this.id})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LaunchFailedError(`Failed to launch browser: ${message}`);
    }
  }

  /**
   * Navigate to a URL.
   */
  async navigate(url: string): Promise<CommandResult> {
    const result = await commands.navigate(this.page, url, {
      timeout: this.config.navigationTimeout,
    });

    const title = await this.page.title();
    this.events.emit('navigated', { url: this.page.url(), title });

    return result;
  }

  /**
   * Click on an element.
   */
  async click(selector: string): Promise<CommandResult> {
    const result = await commands.click(this.page, selector, {
      timeout: this.config.commandTimeout,
    });
    this.events.emit('command', { name: 'click', result });
    return result;
  }

  /**
   * Type text into an input.
   */
  async type(selector: string, text: string): Promise<CommandResult> {
    const result = await commands.typeText(this.page, selector, text, {
      timeout: this.config.commandTimeout,
    });
    this.events.emit('command', { name: 'type', result });
    return result;
  }

  /**
   * Scroll the page.
   */
  async scroll(
    direction: 'up' | 'down' | 'left' | 'right' = 'down',
    amount?: number,
  ): Promise<CommandResult> {
    const result = await commands.scroll(this.page, direction, amount);
    this.events.emit('command', { name: 'scroll', result });
    return result;
  }

  /**
   * Take a screenshot.
   */
  async screenshot(fullPage = false): Promise<ScreenshotData> {
    return commands.screenshot(this.page, { fullPage });
  }

  /**
   * Go back in browser history.
   */
  async goBack(): Promise<CommandResult> {
    const result = await commands.goBack(this.page, {
      timeout: this.config.navigationTimeout,
    });
    this.events.emit('command', { name: 'goBack', result });
    return result;
  }

  /**
   * Go forward in browser history.
   */
  async goForward(): Promise<CommandResult> {
    const result = await commands.goForward(this.page, {
      timeout: this.config.navigationTimeout,
    });
    this.events.emit('command', { name: 'goForward', result });
    return result;
  }

  /**
   * Press a keyboard key.
   */
  async pressKey(key: string): Promise<CommandResult> {
    const result = await commands.pressKey(this.page, key);
    this.events.emit('command', { name: 'pressKey', result });
    return result;
  }

  /**
   * Hover over an element.
   */
  async hover(selector: string): Promise<CommandResult> {
    const result = await commands.hover(this.page, selector, {
      timeout: this.config.commandTimeout,
    });
    this.events.emit('command', { name: 'hover', result });
    return result;
  }

  /**
   * Select a value from a <select> element.
   */
  async select(selector: string, value: string): Promise<CommandResult> {
    const result = await commands.selectOption(this.page, selector, value, {
      timeout: this.config.commandTimeout,
    });
    this.events.emit('command', { name: 'select', result });
    return result;
  }

  /**
   * Evaluate JavaScript in the page context.
   */
  async evaluate<T = any>(expression: string): Promise<T> {
    return this.page.evaluate(expression) as Promise<T>;
  }

  /**
   * Wait for a selector to appear on the page.
   */
  async waitFor(selector: string, timeout?: number): Promise<boolean> {
    return this.inspector.waitForElement(
      selector,
      timeout ?? this.config.commandTimeout,
    );
  }

  /**
   * Get current page information.
   */
  async getPageInfo(): Promise<PageInfo> {
    const page = this.page;
    const viewport = page.viewport();
    return {
      url: page.url(),
      title: await page.title(),
      viewport: {
        width: viewport?.width ?? this.config.viewport.width,
        height: viewport?.height ?? this.config.viewport.height,
      },
    };
  }

  /**
   * Set the viewport size.
   */
  async setViewportSize(size: ViewportSize): Promise<void> {
    await this.page.setViewport({
      width: size.width,
      height: size.height,
    });
  }

  /**
   * Close the browser and clean up.
   */
  async close(): Promise<void> {
    if (!this.browser) return;

    logger.info(`Closing browser (id: ${this.id}, uptime: ${this.uptime}ms)`);

    try {
      await this.browser.close();
    } catch (err) {
      logger.error('Error closing browser:', err);
