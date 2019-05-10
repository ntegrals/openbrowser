import { Page } from 'puppeteer';
import { ElementInfo, Rect } from './types';
import { createLogger } from './logging';
import { sanitizeText, truncateText } from './utils';

const logger = createLogger('dom-inspector');

/**
 * Attributes to capture from elements.
 */
const CAPTURED_ATTRIBUTES = [
  'id', 'class', 'href', 'src', 'alt', 'title', 'type',
  'name', 'value', 'placeholder', 'role', 'aria-label',
  'data-testid',
];

/**
 * Selectors for interactive elements.
 */
const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[onclick]',
  '[tabindex]',
];

/**
 * DomInspector provides methods for inspecting and querying the DOM
 * of a Puppeteer page. It serializes DOM structure, finds interactive
 * elements, and extracts element information.
 */
export class DomInspector {
  constructor(private readonly page: Page) {}

  /**
   * Get a simplified representation of the page's DOM tree.
   * Walks the document body and returns a text-based tree showing
   * the structure and key attributes of visible elements.
   */
  async getPageTree(maxDepth: number = 6): Promise<string> {
    logger.debug('Building page tree');

    const tree = await this.page.evaluate((depth: number) => {
      const lines: string[] = [];

      function isVisible(el: Element): boolean {
        const style = window.getComputedStyle(el);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

