import { Page } from 'playwright';
import { CommandResult } from '../../types';
import { createLogger } from '../../logging';

const logger = createLogger('cmd:find');

/**
 * Find elements matching a text query on the page.
 */
export async function find(
  page: Page,
  query: string,
): Promise<CommandResult> {
  const start = Date.now();
  logger.debug(`find: "${query}"`);

  const matches = await page.evaluate((q: string) => {
    const results: Array<{ tag: string; text: string; index: number }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let index = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim() ?? '';
      if (text.toLowerCase().includes(q.toLowerCase())) {
        const el = node.parentElement;
        results.push({
          tag: el?.tagName.toLowerCase() ?? 'text',
          text: text.slice(0, 100),
          index: index++,
        });
      }
    }
    return results.slice(0, 20);
  }, query);

  return {
    success: true,
    message: `Found ${matches.length} matches for "${query}"`,
    data: matches,
    duration: Date.now() - start,
  };
}
