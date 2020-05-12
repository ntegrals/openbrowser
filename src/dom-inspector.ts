import { Page } from 'playwright';
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

      function getNodeText(el: Element): string {
        let text = '';
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const t = (child.textContent || '').trim();
            if (t) text += t + ' ';
          }
        }
        return text.trim().slice(0, 80);
      }

      function walk(el: Element, indent: number): void {
        if (indent > depth) return;
        if (!isVisible(el)) return;

        const tag = el.tagName.toLowerCase();
        // Skip script, style, noscript, svg internals
        if (['script', 'style', 'noscript', 'link', 'meta'].includes(tag)) return;

        const parts: string[] = [];
        const prefix = '  '.repeat(indent);
        parts.push(prefix + tag);

        // Key attributes
        const id = el.getAttribute('id');
        if (id) parts.push(`#${id}`);

        const role = el.getAttribute('role');
        if (role) parts.push(`[role="${role}"]`);

        const href = el.getAttribute('href');
        if (href && href.length < 60) parts.push(`href="${href}"`);

        const type = el.getAttribute('type');
        if (type) parts.push(`type="${type}"`);

        const placeholder = el.getAttribute('placeholder');
        if (placeholder) parts.push(`placeholder="${placeholder}"`);

        // Direct text content
        const text = getNodeText(el);
        if (text) parts.push(`"${text.slice(0, 50)}"`);

        lines.push(parts.join(' '));

        // Recurse into children
        for (const child of el.children) {
          walk(child, indent + 1);
        }
      }

      const body = document.body;
      if (body) {
        walk(body, 0);
      }

      return lines.join('\n');
    }, maxDepth);

    return tree;
  }

  /**
   * Find all interactive elements on the page and return their info.
   */
  async getInteractiveElements(): Promise<ElementInfo[]> {
    logger.debug('Finding interactive elements');

    const elements = await this.page.evaluate((selectors: string[]) => {
      const results: Array<{
        tag: string;
        id?: string;
        className?: string;
        text?: string;
        href?: string;
        rect: { x: number; y: number; width: number; height: number };
        visible: boolean;
        attributes: Record<string, string>;
      }> = [];

      const selector = selectors.join(', ');
      const els = document.querySelectorAll(selector);

      for (const el of els) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0;

        if (!visible) continue;

        const attrs: Record<string, string> = {};
        for (const attr of el.attributes) {
          attrs[attr.name] = attr.value;
        }

        results.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          text: (el.textContent || '').trim().slice(0, 100) || undefined,
          href: el.getAttribute('href') || undefined,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          visible,
          attributes: attrs,
        });
      }

      return results;
    }, INTERACTIVE_SELECTORS);

    return elements;
  }

  /**
   * Get information about a specific element by CSS selector.
   */
  async getElementInfo(selector: string): Promise<ElementInfo | null> {
    const info = await this.page.$eval(selector, (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;

      const attrs: Record<string, string> = {};
      for (const attr of el.attributes) {
        attrs[attr.name] = attr.value;
      }

      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: el.className || undefined,
        text: (el.textContent || '').trim().slice(0, 200) || undefined,
        href: el.getAttribute('href') || undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        visible,
        attributes: attrs,
      };
    }).catch(() => null);

    return info;
  }

  /**
   * Wait for an element to appear on the page.
   */
  async waitForElement(
    selector: string,
    timeout: number = 5000,
  ): Promise<boolean> {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract the full text content of the page, cleaned up.
   */
  async getPageText(): Promise<string> {
    const text = await this.page.evaluate(() => {
      return document.body?.innerText || '';
    });
    return sanitizeText(text);
  }

  /**
   * Extract text from a specific element.
   */
  async getElementText(selector: string): Promise<string | null> {
    try {
      const text = await this.page.$eval(
        selector,
        (el: Element) => (el as HTMLElement).innerText || el.textContent || '',
      );
      return sanitizeText(text);
    } catch {
      return null;
    }
  }

  /**
   * Get the page's current scroll position and dimensions.
   */
  async getScrollInfo(): Promise<{
    scrollX: number;
    scrollY: number;
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
  }> {
    return this.page.evaluate(() => ({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
    }));
  }
}
