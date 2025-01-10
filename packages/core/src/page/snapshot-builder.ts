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

		// Convert flat AX tree list to the root node
		const rootAx: AXNode = axTree.nodes?.[0] ?? {
			nodeId: '0',
			role: { value: 'WebArea' },
		};

		return { domSnapshot, axTree: rootAx };
	}

	buildTree(
		snapshot: CDPSnapshotResult,
		axTree: AXNode,
		viewportSize: { width: number; height: number },
		capturedAttributes: string[] = [],
	): { root: PageTreeNode; indexCounter: number } {
		this.indexCounter = 0;
		const doc = snapshot.documents[0];
		if (!doc) {
			return {
				root: this.createEmptyNode(),
				indexCounter: 0,
			};
		}

		const { nodes, layout, strings } = doc;

		// Build backend node ID → AX node map
		const axNodeMap = new Map<number, AXNode>();
		this.buildAXMap(axTree, axNodeMap);

		// Build layout index map
		const layoutMap = new Map<number, { bounds: number[]; text?: string; paintOrder?: number }>();
		for (let i = 0; i < layout.nodeIndex.length; i++) {
			const nodeIdx = layout.nodeIndex[i];
			layoutMap.set(nodeIdx, {
				bounds: layout.bounds[i],
				text: layout.text[i] !== -1 ? strings[layout.text[i]] : undefined,
				paintOrder: layout.paintOrder?.[i],
			});
		}

		// Build clickable set
		const clickableSet = new Set<number>();
		if (nodes.isClickable) {
			for (const idx of nodes.isClickable.index) {
				clickableSet.add(idx);
			}
		}

		// Build input value map
		const inputValueMap = new Map<number, string>();
		if (nodes.inputValue) {
			for (let i = 0; i < nodes.inputValue.index.length; i++) {
				const nodeIdx = nodes.inputValue.index[i];
				const valueIdx = nodes.inputValue.value[i];
				inputValueMap.set(nodeIdx, strings[valueIdx]);
			}
		}

		// Build the tree recursively
		const root = this.buildNodeTree(
			0,
			nodes,
			strings,
			layoutMap,
			axNodeMap,
			clickableSet,
			inputValueMap,
			viewportSize,
			capturedAttributes,
		);

		return { root, indexCounter: this.indexCounter };
	}

	private buildNodeTree(
		nodeIndex: number,
		nodes: CDPSnapshotResult['documents'][0]['nodes'],
		strings: string[],
