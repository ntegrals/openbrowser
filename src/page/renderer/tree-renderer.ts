import { createLogger } from '../../logging';

const logger = createLogger('tree-renderer');

export interface TreeNode {
  tag: string;
  attributes: Record<string, string>;
  text?: string;
  children: TreeNode[];
  elementRef?: number;
  visible: boolean;
}

/**
 * Renders a DOM tree into a compact text representation suitable
 * for LLM consumption. Interactive elements are annotated with
 * element references [ref].
 */
export function renderTree(
  nodes: TreeNode[],
  options: { maxDepth?: number; showRefs?: boolean } = {},
): string {
  const { maxDepth = 8, showRefs = true } = options;
  const lines: string[] = [];

  function walk(node: TreeNode, depth: number): void {
    if (depth > maxDepth) return;
    if (!node.visible) return;

    const indent = '  '.repeat(depth);
    const parts: string[] = [indent + node.tag];

    if (showRefs && node.elementRef !== undefined) {
      parts.push(`[${node.elementRef}]`);
    }

    // Key attributes
    const { id, role, href, type, placeholder, value } = node.attributes;
    if (id) parts.push(`#${id}`);
    if (role) parts.push(`role="${role}"`);
    if (href) parts.push(`href="${href.slice(0, 50)}"`);
    if (type) parts.push(`type="${type}"`);
    if (placeholder) parts.push(`placeholder="${placeholder}"`);
    if (value) parts.push(`value="${value.slice(0, 30)}"`);

    if (node.text) {
      parts.push(`"${node.text.slice(0, 60)}"`);
    }

    lines.push(parts.join(' '));

    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  for (const node of nodes) {
    walk(node, 0);
  }

  return lines.join('\n');
}
