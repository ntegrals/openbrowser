import type { PageTreeNode, SelectorIndex, RenderedPageState } from '../types.js';
import type { ElementRef } from '../../types.js';
import { isClickableElement, getClickableDescription } from './interactive-elements.js';
import { filterByPaintOrder } from './layer-order.js';

export interface RendererOptions {
	capturedAttributes: string[];
	maxDepth: number;
	filterPaintOrder: boolean;
	maxElementsInDom: number;
	collapseSvg: boolean;
	deduplicateSiblings: boolean;
	siblingDeduplicateThreshold: number;
	containmentThreshold: number;
}

const DEFAULT_OPTIONS: RendererOptions = {
	capturedAttributes: [
		'title', 'type', 'name', 'role', 'tabindex',
		'aria-label', 'placeholder', 'value', 'alt', 'aria-expanded',
	],
	maxDepth: 100,
	filterPaintOrder: true,
	maxElementsInDom: 2000,
	collapseSvg: true,
	deduplicateSiblings: true,
	siblingDeduplicateThreshold: 5,
	containmentThreshold: 0.95,
};

const SVG_TAGS = new Set(['svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'g', 'defs', 'use', 'symbol', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'text', 'tspan', 'mask', 'filter']);

export class TreeRenderer {
	private options: RendererOptions;

	constructor(options?: Partial<RendererOptions>) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	serializeTree(
		root: PageTreeNode,
		scrollPosition: { x: number; y: number },
		viewportSize: { width: number; height: number },
		documentSize: { width: number; height: number },
	): RenderedPageState {
		const selectorMap: SelectorIndex = {};
		const interactiveElements: PageTreeNode[] = [];

		// Collect interactive elements
		this.collectInteractiveElements(root, interactiveElements);

		// Filter by paint order if enabled
		let visibleElements = this.options.filterPaintOrder
			? filterByPaintOrder(interactiveElements)
			: interactiveElements;

		// Enhanced bounding-box off-screen filtering:
		// Remove elements that are clearly off-screen (negative coords beyond
		// a reasonable threshold, or positioned entirely past the document bounds).
		const offScreenHidden: PageTreeNode[] = [];
		visibleElements = this.filterOffScreenElements(
			visibleElements,
			scrollPosition,
			viewportSize,
			documentSize,
			offScreenHidden,
		);

		// Build selector map
		for (const node of visibleElements) {
			if (node.highlightIndex !== undefined) {
				selectorMap[node.highlightIndex] = {
					cssSelector: node.cssSelector ?? this.buildCssSelector(node),
					xpath: node.xpath,
					backendNodeId: node.backendNodeId,
					tagName: node.tagName,
					role: node.role,
					ariaLabel: node.ariaLabel,
					text: node.text?.trim()?.slice(0, 100),
				};
