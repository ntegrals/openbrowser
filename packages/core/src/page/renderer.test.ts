import { test, expect, describe, beforeEach } from 'bun:test';
import { TreeRenderer } from './renderer/tree-renderer.js';
import type { PageTreeNode, SelectorIndex } from './types.js';
import type { ElementRef } from '../types.js';

// ── Helpers ──

function makeNode(overrides: Partial<PageTreeNode> = {}): PageTreeNode {
	return {
		tagName: 'div',
		nodeType: 'element',
		attributes: {},
		children: [],
		isVisible: true,
		isInteractive: false,
		isClickable: false,
		isEditable: false,
		isScrollable: false,
		...overrides,
	};
}

function makeTextNode(text: string): PageTreeNode {
	return makeNode({
		tagName: '',
		nodeType: 'text',
		text,
		children: [],
	});
}

const defaultScroll = { x: 0, y: 0 };
const defaultViewport = { width: 1280, height: 800 };
const defaultDocSize = { width: 1280, height: 3000 };

// ── Tests ──

describe('TreeRenderer', () => {
	let serializer: TreeRenderer;

	beforeEach(() => {
		serializer = new TreeRenderer({
			capturedAttributes: ['title', 'role', 'aria-label', 'placeholder'],
			filterPaintOrder: false,
		});
	});

	describe('basic tree serialization', () => {
		test('serializes a simple root with text child', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'body',
						children: [
							makeNode({
								tagName: 'h1',
								text: 'Hello World',
								children: [],
							}),
						],
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			expect(state.tree).toContain('h1');
			expect(state.tree).toContain('Hello World');
			expect(state.scrollPosition).toEqual(defaultScroll);
			expect(state.viewportSize).toEqual(defaultViewport);
		});

		test('includes element count and interactive element count', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'button',
						isInteractive: true,
						isVisible: true,
						highlightIndex: 0 as ElementRef,
						text: 'Click me',
						cssSelector: '#btn',
					}),
					makeNode({
						tagName: 'p',
						text: 'Paragraph',
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			expect(state.interactiveElementCount).toBeGreaterThanOrEqual(1);
			expect(state.elementCount).toBeGreaterThanOrEqual(1);
		});

		test('builds selector map for interactive elements with highlightIndex', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'button',
						isInteractive: true,
						isVisible: true,
						highlightIndex: 0 as ElementRef,
						cssSelector: '#submit-btn',
						text: 'Submit',
						role: 'button',
						ariaLabel: 'Submit form',
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			expect(state.selectorMap[0]).toBeDefined();
			expect(state.selectorMap[0].cssSelector).toBe('#submit-btn');
			expect(state.selectorMap[0].tagName).toBe('button');
			expect(state.selectorMap[0].role).toBe('button');
			expect(state.selectorMap[0].ariaLabel).toBe('Submit form');
		});

		test('includes highlight index in serialized output', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'a',
						isInteractive: true,
						isVisible: true,
						highlightIndex: 3 as ElementRef,
						cssSelector: 'a.link',
						text: 'Link text',
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('[3]');
		});

		test('computes pixelsAbove and pixelsBelow', () => {
			const root = makeNode({ tagName: 'html' });
			const state = serializer.serializeTree(
				root,
				{ x: 0, y: 400 },
				{ width: 1280, height: 800 },
				{ width: 1280, height: 2000 },
			);

			expect(state.pixelsAbove).toBe(400);
			expect(state.pixelsBelow).toBe(800); // 2000 - 400 - 800
		});
	});

	describe('SVG collapse', () => {
		test('collapses SVG to placeholder with icon label', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'svg',
						isVisible: true,
						attributes: {},
						children: [
							makeNode({
								tagName: 'path',
								isVisible: true,
								attributes: { d: 'M0 0L10 10' },
							}),
						],
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('<svg>icon</svg>');
		});

		test('uses aria-label from SVG if available', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'svg',
						isVisible: true,
						ariaLabel: 'Search icon',
						attributes: {},
						children: [],
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('<svg>Search icon</svg>');
		});

		test('finds title in nested SVG structure', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'svg',
						isVisible: true,
						attributes: {},
						children: [
							makeNode({
								tagName: 'title',
								isVisible: true,
								text: 'Close button',
								nodeType: 'element',
								attributes: {},
								children: [],
							}),
						],
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('<svg>Close button</svg>');
		});

		test('includes highlight index on interactive SVG', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'svg',
						isVisible: true,
						isInteractive: true,
						highlightIndex: 5 as ElementRef,
						cssSelector: 'svg.icon',
						attributes: {},
						children: [],
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('[5]<svg>');
		});

		test('does not collapse SVG when collapseSvg is disabled', () => {
			const noCollapse = new TreeRenderer({
				collapseSvg: false,
				filterPaintOrder: false,
			});
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'svg',
						isVisible: true,
						attributes: {},
						children: [
							makeNode({
								tagName: 'rect',
								isVisible: true,
								attributes: {},
							}),
						],
					}),
				],
			});

			const state = noCollapse.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			// Should not be collapsed to a single <svg>icon</svg> placeholder
			expect(state.tree).toContain('<svg>');
			// Inner SVG elements (path, rect, etc.) are always skipped by the
			// SVG_TAGS filter, so they won't appear. The key difference is
			// collapseSvg=false does NOT produce the collapsed placeholder format.
			expect(state.tree).not.toContain('<svg>icon</svg>');
		});
	});

	describe('sibling deduplication', () => {
		test('deduplicates runs of same-tag non-interactive siblings', () => {
			// Create 8 identical li elements (threshold = 5)
			const listItems = Array.from({ length: 8 }, (_, i) =>
				makeNode({
					tagName: 'li',
					isVisible: true,
					text: `Item ${i}`,
					children: [],
				}),
			);

			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'ul',
						isVisible: true,
						children: listItems,
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			// Should show first 3 and then "... and 5 more" summary
			expect(state.tree).toContain('Item 0');
			expect(state.tree).toContain('Item 1');
			expect(state.tree).toContain('Item 2');
			expect(state.tree).toContain('... and 5 more <li> elements');
			expect(state.tree).not.toContain('Item 7');
		});

		test('does not deduplicate when below threshold', () => {
			const items = Array.from({ length: 3 }, (_, i) =>
				makeNode({
					tagName: 'li',
					isVisible: true,
					text: `Item ${i}`,
					children: [],
				}),
			);
