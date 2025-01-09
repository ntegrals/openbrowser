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
			for (const child of node.children) {
				this.serializeNode(child, lines, depth + 1, selectorMap, ctx, maxElements);
			}
		}

		// Closing tag only if there were children
		if (node.children.some((c) => c.isVisible || c.nodeType === 'text')) {
			lines.push(`${indent}</${node.tagName}>`);
		}
	}

	/**
	 * Serialize children but deduplicate runs of similar siblings.
	 * If more than N consecutive siblings have the same tagName and no interactive children,
	 * show the first few and add "... and N-3 more" summary.
	 */
	private serializeChildrenWithDedup(
		children: PageTreeNode[],
		lines: string[],
		depth: number,
		selectorMap: SelectorIndex,
		ctx: { count: number; maxReached: boolean },
		maxElements: number,
	): void {
		const threshold = this.options.siblingDeduplicateThreshold;
		let i = 0;

		while (i < children.length) {
			if (ctx.maxReached) return;

			const child = children[i];

			// Find run of same-tag non-interactive siblings
			let runEnd = i + 1;
			if (
				child.nodeType === 'element' &&
				!child.isInteractive &&
				!this.hasInteractiveDescendant(child)
			) {
				while (
					runEnd < children.length &&
					children[runEnd].nodeType === 'element' &&
					children[runEnd].tagName === child.tagName &&
					!children[runEnd].isInteractive &&
					!this.hasInteractiveDescendant(children[runEnd])
				) {
					runEnd++;
				}
			}

			const runLength = runEnd - i;
			if (runLength > threshold) {
				// Show first 3, then summarize
				const showCount = 3;
				for (let j = i; j < i + showCount && j < runEnd; j++) {
					this.serializeNode(children[j], lines, depth, selectorMap, ctx, maxElements);
				}
				const indent = '\t'.repeat(depth);
				lines.push(`${indent}... and ${runLength - showCount} more <${child.tagName}> elements`);
				i = runEnd;
			} else {
				this.serializeNode(child, lines, depth, selectorMap, ctx, maxElements);
				i++;
			}
		}
	}

	/**
	 * Check if a node is a redundant wrapper: single visible child, no interactive
	 * properties, no highlight index, generic tag.
	 */
	private isRedundantWrapper(node: PageTreeNode): boolean {
		if (node.highlightIndex !== undefined) return false;
		if (node.isInteractive) return false;

		const visibleChildren = node.children.filter(
			(c) => c.isVisible || c.isInteractive || c.nodeType === 'text',
		);

		if (visibleChildren.length !== 1) return false;

		const genericTags = new Set(['div', 'span', 'section', 'article', 'main']);
		if (!genericTags.has(node.tagName)) return false;

		// Check containment: does the parent rect fully contain the child rect?
		if (node.rect && visibleChildren[0].rect) {
			const parentArea = node.rect.width * node.rect.height;
			const childArea = visibleChildren[0].rect.width * visibleChildren[0].rect.height;
			if (parentArea > 0 && childArea / parentArea > this.options.containmentThreshold) {
				return true;
			}
		}

		return false;
	}

	private getInlineText(node: PageTreeNode): string | null {
		if (node.children.length === 0) {
			return node.text?.trim() || null;
		}
		if (
			node.children.length === 1 &&
			node.children[0].nodeType === 'text' &&
			node.children[0].text
		) {
			return node.children[0].text.trim();
		}
		return null;
	}

	private hasVisibleDescendant(node: PageTreeNode): boolean {
		for (const child of node.children) {
			if (child.isVisible || child.isInteractive) return true;
			if (this.hasVisibleDescendant(child)) return true;
		}
		return false;
	}

	private hasInteractiveDescendant(node: PageTreeNode): boolean {
		for (const child of node.children) {
			if (child.isInteractive || child.highlightIndex !== undefined) return true;
			if (this.hasInteractiveDescendant(child)) return true;
		}
		return false;
	}

	private collectInteractiveElements(
		node: PageTreeNode,
		result: PageTreeNode[],
	): void {
		if (node.highlightIndex !== undefined && node.isVisible) {
			result.push(node);
		}
		for (const child of node.children) {
			this.collectInteractiveElements(child, result);
		}
	}

	private buildCssSelector(node: PageTreeNode): string {
		const parts: string[] = [];
		let current: PageTreeNode | undefined = node;

		while (current && current.tagName !== 'html') {
			let selector = current.tagName;

			if (current.attributes['id']) {
				selector = `#${current.attributes['id']}`;
				parts.unshift(selector);
				break;
			}

			if (current.parentNode) {
				const siblings = current.parentNode.children.filter(
					(c) => c.tagName === current!.tagName,
				);
				if (siblings.length > 1) {
					const idx = siblings.indexOf(current) + 1;
					selector += `:nth-of-type(${idx})`;
				}
			}

			parts.unshift(selector);
			current = current.parentNode;
		}

		return parts.join(' > ');
	}

	/**
	 * Enhanced off-screen element filtering.
	 * Removes interactive elements whose bounding boxes fall entirely outside
	 * reasonable document bounds, or that have degenerate rects (negative width/height,
	 * extremely large offsets indicating hidden off-canvas positioning).
	 * Elements that are simply scrolled out of the current viewport are NOT removed --
	 * they are collected into the offScreenHidden array for hint formatting.
	 */
	private filterOffScreenElements(
		elements: PageTreeNode[],
		scrollPosition: { x: number; y: number },
		viewportSize: { width: number; height: number },
		documentSize: { width: number; height: number },
		offScreenHidden: PageTreeNode[],
	): PageTreeNode[] {
		// Anything positioned more than this many pixels outside the document
		// is almost certainly a hidden/off-canvas element (e.g. left: -9999px).
		const offCanvasThreshold = 5000;

		const vpTop = scrollPosition.y;
		const vpBottom = scrollPosition.y + viewportSize.height;
		const vpLeft = scrollPosition.x;
		const vpRight = scrollPosition.x + viewportSize.width;

		const result: PageTreeNode[] = [];

		for (const node of elements) {
			if (!node.rect) {
				result.push(node);
				continue;
			}

			const { x, y, width, height } = node.rect;

			// Degenerate rects: negative dimensions or zero-area
			if (width <= 0 || height <= 0) {
				continue;
			}

			// Off-canvas positioning (common CSS hidden pattern: left: -9999px)
			if (
				x + width < -offCanvasThreshold ||
				y + height < -offCanvasThreshold ||
				x > documentSize.width + offCanvasThreshold ||
				y > documentSize.height + offCanvasThreshold
			) {
				continue;
			}

			// Check if the element is inside the current viewport
			const nodeBottom = y + height;
			const nodeRight = x + width;
			const inViewport =
				nodeBottom >= vpTop &&
				y <= vpBottom &&
				nodeRight >= vpLeft &&
				x <= vpRight;

			if (inViewport) {
				result.push(node);
			} else {
				// Off-screen but within reasonable document bounds --
				// keep it in the selector map but track it for hint section
				result.push(node);
				offScreenHidden.push(node);
			}
		}

		return result;
	}

	/**
	 * Format hidden element hints for the serialized output.
	 * Groups off-screen elements by direction and provides scroll distance estimates.
	 */
	private formatHiddenElementHints(
		offScreenElements: PageTreeNode[],
		scrollPosition: { x: number; y: number },
		viewportSize: { width: number; height: number },
	): string[] {
		if (offScreenElements.length === 0) return [];

		const vpBottom = scrollPosition.y + viewportSize.height;
		const vpTop = scrollPosition.y;
		const hints: string[] = [];

		for (const node of offScreenElements) {
			if (!node.rect) continue;
			const desc = this.getNodeDescription(node);
			const elementY = node.rect.y;

			if (elementY > vpBottom) {
				const pxBelow = elementY - vpBottom;
				const pagesBelow = (pxBelow / viewportSize.height).toFixed(1);
				hints.push(`  ${node.tagName} "${desc}" ~${pagesBelow} pages below`);
			} else if (elementY + node.rect.height < vpTop) {
				const pxAbove = vpTop - (elementY + node.rect.height);
				const pagesAbove = (pxAbove / viewportSize.height).toFixed(1);
				hints.push(`  ${node.tagName} "${desc}" ~${pagesAbove} pages above`);
			} else {
				// Off to the side
				hints.push(`  ${node.tagName} "${desc}" off-screen horizontally`);
			}
		}

		return hints;
	}

	/**
	 * Get a short human-readable description of a node for hint text.
	 */
	private getNodeDescription(node: PageTreeNode): string {
		if (node.ariaLabel) return node.ariaLabel.slice(0, 60);
		if (node.text) return node.text.trim().slice(0, 60);
		if (node.attributes['title']) return node.attributes['title'].slice(0, 60);
		if (node.attributes['placeholder']) return node.attributes['placeholder'].slice(0, 60);
		return node.tagName;
	}

	/**
	 * Resolve the best description for an SVG, traversing nested SVG wrappers
	 * to find the deepest aria-label or title. This collapses redundant
	 * nested SVG containers into a single description.
	 */
	private resolveSvgDescription(node: PageTreeNode): string {
		// Check the current node for labels
		const label = node.ariaLabel || node.attributes['aria-label'] || '';
		const title = node.attributes['title'] || '';

		// Look for nested SVGs that might carry a better description
		let deepLabel = '';
		const visitSvgChildren = (n: PageTreeNode): void => {
			for (const child of n.children) {
				if (child.tagName === 'title' && child.text) {
					deepLabel = child.text.trim();
					return;
				}
				if (child.tagName === 'svg') {
					// Nested SVG -- check it for labels
					const nested =
						child.ariaLabel ||
						child.attributes['aria-label'] ||
						child.attributes['title'] ||
						'';
					if (nested) {
						deepLabel = nested;
						return;
					}
					// Keep traversing deeper
					visitSvgChildren(child);
					if (deepLabel) return;
				}
				if (SVG_TAGS.has(child.tagName)) {
					visitSvgChildren(child);
					if (deepLabel) return;
				}
			}
		};

		visitSvgChildren(node);

		return label || title || deepLabel || 'icon';
	}
}
