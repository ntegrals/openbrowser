import type { CDPSession } from 'playwright';
import type {
	CDPSnapshotResult,
	AXNode,
	PageTreeNode,
	DOMRect,
} from './types.js';
import { type ElementRef, elementIndex } from '../types.js';

const INTERACTIVE_TAGS = new Set([
	'a', 'button', 'input', 'select', 'textarea', 'details', 'summary',
	'label', 'option', 'fieldset', 'legend',
]);

const INTERACTIVE_ROLES = new Set([
	'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
	'listbox', 'menu', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
	'option', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab',
	'treeitem', 'gridcell', 'columnheader', 'rowheader',
]);

const INVISIBLE_TAGS = new Set([
	'script', 'style', 'link', 'meta', 'head', 'noscript', 'template',
]);

export class SnapshotBuilder {
	private indexCounter = 0;

	async captureSnapshot(cdpSession: CDPSession): Promise<{
		domSnapshot: CDPSnapshotResult;
		axTree: AXNode;
	}> {
		const [domSnapshot, axTree] = await Promise.all([
			cdpSession.send('DOMSnapshot.captureSnapshot', {
				computedStyles: ['display', 'visibility', 'opacity', 'overflow'],
				includeDOMRects: true,
				includePaintOrder: true,
			}) as Promise<unknown> as Promise<CDPSnapshotResult>,
			cdpSession.send('Accessibility.getFullAXTree', {}) as Promise<unknown> as Promise<{ nodes: AXNode[] }>,
		]);
