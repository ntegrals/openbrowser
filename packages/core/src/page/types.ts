import type { ElementRef } from '../types.js';

export interface DOMRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TargetInfo {
	targetId: string;
	type: 'page' | 'iframe' | 'worker' | 'other';
	url: string;
	title?: string;
	attached: boolean;
}

export interface TargetAllTrees {
	mainTree: PageTreeNode;
	iframeTrees: Array<{
		targetInfo: TargetInfo;
		tree: PageTreeNode;
		parentNodeId?: number;
	}>;
}

export interface InteractedElement {
	index: ElementRef;
	tagName: string;
	text?: string;
	role?: string;
	ariaLabel?: string;
	action: string;
	timestamp: number;
}

export const MatchLevel = {
	EXACT: 'exact',
	PARTIAL: 'partial',
	FUZZY: 'fuzzy',
	NONE: 'none',
} as const;
export type MatchLevel = (typeof MatchLevel)[keyof typeof MatchLevel];

export interface SimplifiedNode {
	tag: string;
	text?: string;
	attrs: Record<string, string>;
	children: SimplifiedNode[];
	index?: ElementRef;
	isInteractive: boolean;
}

export interface PageTreeNode {
	tagName: string;
	nodeType: 'element' | 'text';
	text?: string;
	attributes: Record<string, string>;
	children: PageTreeNode[];

	// Layout info
	isVisible: boolean;
	rect?: DOMRect;

	// A11y info
	role?: string;
	ariaLabel?: string;
	ariaExpanded?: boolean;

	// Interaction info
	isInteractive: boolean;
	isClickable: boolean;
	isEditable: boolean;
	isScrollable: boolean;

	// Index for LLM reference
	highlightIndex?: ElementRef;

	// Parent reference (not serialized)
	parentNode?: PageTreeNode;

	// CDP node info
	backendNodeId?: number;
	nodeId?: number;

	// Selector info
	cssSelector?: string;
	xpath?: string;

	// Shadow DOM
	isShadowRoot?: boolean;
	shadowChildren?: PageTreeNode[];

	// Input state
	inputValue?: string;
	isChecked?: boolean;
	selectedOption?: string;

	// Paint order for z-index filtering
	paintOrder?: number;
}

export interface SelectorIndex {
	[index: number]: {
		cssSelector: string;
		xpath?: string;
		backendNodeId?: number;
		tagName: string;
		role?: string;
		ariaLabel?: string;
		text?: string;
	};
}

export interface RenderedPageState {
	tree: string;
	selectorMap: SelectorIndex;
	elementCount: number;
	interactiveElementCount: number;
	scrollPosition: { x: number; y: number };
	viewportSize: { width: number; height: number };
	documentSize: { width: number; height: number };
	pixelsAbove: number;
	pixelsBelow: number;
}

export interface CDPDOMNode {
	nodeType: number;
	nodeName: string;
	nodeValue: string;
	backendNodeId: number;
	childNodeIndexes?: number[];
	attributes?: string[];
	parentIndex?: number;
	contentDocumentIndex?: number;
	shadowRootType?: string;
	isClickable?: boolean;
	inputValue?: { value: string; type?: string };
	currentSourceURL?: string;
	textValue?: string;
	layoutNodeIndex?: number;
}

export interface CDPLayoutNode {
	nodeIndex: number;
	bounds: number[];
	text?: string;
	stackingContexts?: { index: number }[];
	paintOrder?: number;
	isStackingContext?: boolean;
}

export interface CDPSnapshotResult {
	documents: Array<{
		nodes: {
			nodeType: number[];
			nodeName: number[];
			nodeValue: number[];
			backendNodeId: number[];
			childNodeIndexes?: number[][];
			attributes: Array<number[]>;
			parentIndex: number[];
			contentDocumentIndex?: { index: number[] };
			shadowRootType?: { index: number[]; value: number[] };
			isClickable?: { index: number[] };
			inputValue?: { index: number[]; value: number[] };
			currentSourceURL?: { index: number[]; value: number[] };
		};
		layout: {
			nodeIndex: number[];
			bounds: number[][];
			text: number[];
			stackingContexts?: { index: number[] };
			paintOrder?: number[];
			styles: number[][];
		};
		textBoxes: {
			layoutIndex: number[];
			bounds: number[][];
		};
