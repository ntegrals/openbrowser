import type { PageTreeNode } from '../types.js';

const ALWAYS_CLICKABLE_TAGS = new Set([
	'a', 'button', 'input', 'select', 'textarea', 'summary',
]);

const CLICKABLE_ROLES = new Set([
	'button', 'link', 'menuitem', 'option', 'tab', 'treeitem',
	'checkbox', 'radio', 'switch',
]);

export function isClickableElement(node: PageTreeNode): boolean {
	if (ALWAYS_CLICKABLE_TAGS.has(node.tagName)) return true;
	if (node.role && CLICKABLE_ROLES.has(node.role)) return true;
	if (node.attributes['onclick']) return true;
	if (node.attributes['tabindex'] && node.attributes['tabindex'] !== '-1') return true;
	if (node.attributes['role'] && CLICKABLE_ROLES.has(node.attributes['role'])) return true;
	return node.isClickable;
}

export function getClickableDescription(node: PageTreeNode): string {
	const parts: string[] = [];

	if (node.ariaLabel) {
		parts.push(node.ariaLabel);
	} else if (node.text) {
		parts.push(node.text.trim().slice(0, 50));
	} else if (node.attributes['title']) {
		parts.push(node.attributes['title']);
	} else if (node.attributes['alt']) {
		parts.push(node.attributes['alt']);
	} else if (node.attributes['placeholder']) {
		parts.push(node.attributes['placeholder']);
	}

	return parts.join(' - ') || node.tagName;
}
