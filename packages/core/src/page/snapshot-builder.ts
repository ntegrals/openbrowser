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
		layoutMap: Map<number, { bounds: number[]; text?: string; paintOrder?: number }>,
		axNodeMap: Map<number, AXNode>,
		clickableSet: Set<number>,
		inputValueMap: Map<number, string>,
		viewportSize: { width: number; height: number },
		capturedAttributes: string[],
	): PageTreeNode {
		const nodeType = nodes.nodeType[nodeIndex];
		const tagName = strings[nodes.nodeName[nodeIndex]]?.toLowerCase() ?? '';
		const backendNodeId = nodes.backendNodeId[nodeIndex];

		// Check layout
		const layoutInfo = layoutMap.get(nodeIndex);
		let rect: DOMRect | undefined;
		let isVisible = false;

		if (layoutInfo) {
			const [x, y, w, h] = layoutInfo.bounds;
			rect = { x, y, width: w, height: h };
			isVisible = w > 0 && h > 0 && !INVISIBLE_TAGS.has(tagName);
		}

		// Parse attributes
		const rawAttrs = nodes.attributes[nodeIndex] ?? [];
		const attributes: Record<string, string> = {};
		for (let i = 0; i < rawAttrs.length; i += 2) {
			const name = strings[rawAttrs[i]];
			const value = strings[rawAttrs[i + 1]];
			if (name && (capturedAttributes.length === 0 || capturedAttributes.includes(name))) {
				attributes[name] = value ?? '';
			}
		}

		// Get AX info
		const axNode = axNodeMap.get(backendNodeId);
		const role = axNode?.role?.value;
		const ariaLabel = axNode?.name?.value;

		// Determine interactivity
		const isInteractive =
			INTERACTIVE_TAGS.has(tagName) ||
			(role ? INTERACTIVE_ROLES.has(role) : false) ||
			clickableSet.has(nodeIndex) ||
			attributes['tabindex'] !== undefined ||
			attributes['contenteditable'] === 'true';

		const isEditable =
			tagName === 'input' ||
			tagName === 'textarea' ||
			attributes['contenteditable'] === 'true' ||
			role === 'textbox' ||
			role === 'searchbox';

		const isScrollable =
			tagName === 'body' || tagName === 'html' || attributes['role'] === 'scrollbar';

		// Build node
		const node: PageTreeNode = {
			tagName,
			nodeType: nodeType === 3 ? 'text' : 'element',
			text: nodeType === 3 ? strings[nodes.nodeValue[nodeIndex]] : layoutInfo?.text,
			attributes,
			children: [],
			isVisible,
			rect,
			role: role && role !== 'none' && role !== 'generic' ? role : undefined,
			ariaLabel,
			isInteractive,
			isClickable: clickableSet.has(nodeIndex) || INTERACTIVE_TAGS.has(tagName),
			isEditable,
			isScrollable,
			backendNodeId,
			paintOrder: layoutInfo?.paintOrder,
			inputValue: inputValueMap.get(nodeIndex),
		};

		// Assign highlight index for interactive/visible elements
		if (isInteractive && isVisible) {
			node.highlightIndex = elementIndex(this.indexCounter++);
		}
