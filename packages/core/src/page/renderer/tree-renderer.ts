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
			pixelsAbove,
			pixelsBelow,
		};
	}

	private serializeNode(
		node: PageTreeNode,
		lines: string[],
		depth: number,
		selectorMap: SelectorIndex,
		ctx: { count: number; maxReached: boolean },
		maxElements: number,
	): void {
		if (depth > this.options.maxDepth) return;
		if (ctx.maxReached) return;
		if (!node.isVisible && node.nodeType === 'element' && node.children.length === 0) return;

		const indent = '\t'.repeat(depth);

		if (node.nodeType === 'text') {
			const text = node.text?.trim();
			if (text) {
				lines.push(`${indent}${text}`);
			}
			return;
		}

		// Skip invisible non-interactive containers with no visible children
		if (!node.isVisible && !node.isInteractive && !this.hasVisibleDescendant(node)) {
			return;
		}

		// Collapse SVGs to placeholder, with containment deduplication for nested SVGs.
		// When an SVG contains only other SVG elements (nested wrappers), we collapse
		// them into a single placeholder using the deepest label we can find.
		if (this.options.collapseSvg && node.tagName === 'svg') {
			const desc = this.resolveSvgDescription(node);
			if (node.highlightIndex !== undefined && selectorMap[node.highlightIndex]) {
				lines.push(`${indent}[${node.highlightIndex}]<svg>${desc}</svg>`);
			} else {
				lines.push(`${indent}<svg>${desc}</svg>`);
			}
			ctx.count++;
			return;
		}

		// Skip inner SVG elements
		if (SVG_TAGS.has(node.tagName) && node.tagName !== 'svg') {
			return;
		}

		ctx.count++;
		if (ctx.count > maxElements) {
			ctx.maxReached = true;
			return;
		}

		// Containment check: if parent fully contains only this child, prefer showing child
		// (handled implicitly by tree traversal — we just skip redundant wrappers)
		if (this.isRedundantWrapper(node)) {
			for (const child of node.children) {
				this.serializeNode(child, lines, depth, selectorMap, ctx, maxElements);
			}
			return;
		}

		// Build tag representation
		const parts: string[] = [];

		// Highlight index for interactive elements
		if (node.highlightIndex !== undefined && selectorMap[node.highlightIndex]) {
			parts.push(`[${node.highlightIndex}]`);
		}

		// Tag name
		parts.push(`<${node.tagName}`);

		// Attributes
		const attrParts: string[] = [];
		for (const attr of this.options.capturedAttributes) {
			const value = node.attributes[attr];
			if (value !== undefined && value !== '') {
				attrParts.push(`${attr}="${value}"`);
			}
		}

		// Prefer AX node name over DOM text when available
		if (node.role) {
			attrParts.push(`role="${node.role}"`);
		}
		if (node.ariaLabel && !node.attributes['aria-label']) {
			attrParts.push(`aria-label="${node.ariaLabel}"`);
		}

		if (attrParts.length > 0) {
			parts.push(` ${attrParts.join(' ')}`);
		}

		// Input value
		if (node.inputValue !== undefined) {
			parts.push(` value="${node.inputValue}"`);
		}

		parts.push('>');

		// Inline text for leaf elements
		const inlineText = this.getInlineText(node);
		if (inlineText) {
			parts.push(inlineText);
			parts.push(`</${node.tagName}>`);
			lines.push(`${indent}${parts.join('')}`);
			return;
		}

		lines.push(`${indent}${parts.join('')}`);

		// Deduplicate similar siblings
		if (this.options.deduplicateSiblings) {
			this.serializeChildrenWithDedup(node.children, lines, depth + 1, selectorMap, ctx, maxElements);
		} else {
