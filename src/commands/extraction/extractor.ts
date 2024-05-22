import { Page } from 'playwright';
import { createLogger } from '../../logging';

const logger = createLogger('content-extractor');

/**
 * Extract structured content from a page.
 */
export class ContentExtractor {
  constructor(private readonly page: Page) {}

  async extractText(selector?: string): Promise<string> {
    if (selector) {
      return this.page.$eval(selector, (el) => (el as HTMLElement).innerText || '');
    }
    return this.page.evaluate(() => document.body?.innerText || '');
  }

  async extractLinks(): Promise<Array<{ text: string; href: string }>> {
    return this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({
          text: (a.textContent || '').trim(),
          href: a.getAttribute('href') || '',
        }))
        .filter(l => l.text && l.href && !l.href.startsWith('#'));
    });
  }

  async extractTables(): Promise<Array<string[][]>> {
    return this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('table')).map(table => {
        return Array.from(table.querySelectorAll('tr')).map(row => {
          return Array.from(row.querySelectorAll('td, th')).map(
            cell => (cell.textContent || '').trim()
          );
        });
      });
    });
  }
}
