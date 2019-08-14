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
