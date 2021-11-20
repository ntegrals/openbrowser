import { Page } from 'playwright';
import { createLogger } from '../logging';
import { renderTree, TreeNode } from './renderer/tree-renderer';
import { isInteractive } from './renderer/interactive-elements';
import type { PageSnapshot } from './types';

const logger = createLogger('snapshot-builder');

/**
 * Builds a snapshot of the current page state by walking the DOM
 * and creating a tree representation.
 */
export async function buildSnapshot(
  page: Page,
  options: { maxDepth?: number; capturedAttributes?: string[] } = {},
): Promise<PageSnapshot> {
  const { maxDepth = 8, capturedAttributes = ['id', 'class', 'role', 'href', 'type', 'placeholder', 'value', 'aria-label', 'name', 'alt'] } = options;

  const rawTree = await page.evaluate((attrs: string[]) => {
    let refCounter = 0;

    function walk(el: Element, depth: number, maxD: number): any {
      if (depth > maxD) return null;

      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'link', 'meta'].includes(tag)) return null;

      const style = window.getComputedStyle(el);
      const visible = style.display !== 'none' && style.visibility !== 'hidden';
      if (!visible) return null;

      const attributes: Record<string, string> = {};
      for (const attr of attrs) {
        const val = el.getAttribute(attr);
        if (val) attributes[attr] = val;
      }

      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = (child.textContent || '').trim();
          if (t) text += t + ' ';
        }
      }

      const children: any[] = [];
      for (const child of el.children) {
        const c = walk(child, depth + 1, maxD);
        if (c) children.push(c);
      }

      return { tag, attributes, text: text.trim() || undefined, children, visible: true };
    }

    const body = document.body;
    if (!body) return [];

    const result: any[] = [];
    for (const child of body.children) {
      const node = walk(child, 0, maxD);
      if (node) result.push(node);
    }
    return result;
  }, capturedAttributes);

  // Assign element refs to interactive elements
  let refCounter = 0;
  function assignRefs(nodes: any[]): TreeNode[] {
    return nodes.map(n => {
      const node: TreeNode = {
        tag: n.tag,
        attributes: n.attributes,
        text: n.text,
        visible: n.visible,
        children: assignRefs(n.children || []),
      };
      if (isInteractive(n.tag, n.attributes)) {
        node.elementRef = refCounter++;
      }
      return node;
    });
  }

  const tree = assignRefs(rawTree);
  const rendered = renderTree(tree, { maxDepth });

  return {
    url: page.url(),
    title: await page.title(),
    tree: rendered,
    interactiveCount: refCounter,
    timestamp: Date.now(),
  };
}
