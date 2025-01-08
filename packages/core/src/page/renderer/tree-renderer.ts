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
			}
		}

		// Serialize to text with element cap
		const lines: string[] = [];
		let elementCount = 0;
		const maxElements = this.options.maxElementsInDom;

		const countingContext = { count: 0, maxReached: false };
		this.serializeNode(root, lines, 0, selectorMap, countingContext, maxElements);
		elementCount = Object.keys(selectorMap).length;

		if (countingContext.maxReached) {
			lines.push(`\n[... DOM truncated at ${maxElements} elements]`);
		}

		// Append hidden element hint section for off-screen interactive elements
		const hiddenHints = this.formatHiddenElementHints(offScreenHidden, scrollPosition, viewportSize);
		if (hiddenHints.length > 0) {
			lines.push('');
			lines.push('--- Off-screen interactive elements ---');
			for (const hint of hiddenHints.slice(0, 15)) {
				lines.push(hint);
			}
			if (hiddenHints.length > 15) {
				lines.push(`... and ${hiddenHints.length - 15} more off-screen elements`);
			}
		}

		const pixelsAbove = scrollPosition.y;
		const pixelsBelow = Math.max(0, documentSize.height - scrollPosition.y - viewportSize.height);

		return {
			tree: lines.join('\n'),
			selectorMap,
			elementCount,
			interactiveElementCount: visibleElements.length,
			scrollPosition,
			viewportSize,
			documentSize,
