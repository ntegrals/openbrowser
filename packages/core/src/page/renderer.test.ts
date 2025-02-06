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

			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'ul',
						isVisible: true,
						children: items,
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			expect(state.tree).toContain('Item 0');
			expect(state.tree).toContain('Item 1');
			expect(state.tree).toContain('Item 2');
			expect(state.tree).not.toContain('... and');
		});

		test('does not deduplicate siblings with interactive descendants', () => {
			const items = Array.from({ length: 8 }, (_, i) =>
				makeNode({
					tagName: 'li',
					isVisible: true,
					children: [
						makeNode({
							tagName: 'a',
							isInteractive: i === 4, // one has interactive child
							isVisible: true,
							highlightIndex: i === 4 ? (10 as ElementRef) : undefined,
							text: `Link ${i}`,
						}),
					],
				}),
			);

			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'ul',
						isVisible: true,
						children: items,
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			// Because item 4 has an interactive descendant, the run is broken
			// and items should not all be deduped away
			expect(state.tree).toContain('Link 4');
		});

		test('does not deduplicate when deduplicateSiblings is disabled', () => {
			const noDedup = new TreeRenderer({
				deduplicateSiblings: false,
				filterPaintOrder: false,
			});

			const items = Array.from({ length: 8 }, (_, i) =>
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
						children: items,
					}),
				],
			});

			const state = noDedup.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).not.toContain('... and');
			expect(state.tree).toContain('Item 7');
		});
	});

	describe('max elements cap', () => {
		test('truncates tree when max elements is exceeded', () => {
			const small = new TreeRenderer({
				maxElementsInDom: 5,
				filterPaintOrder: false,
				deduplicateSiblings: false,
			});

			const children = Array.from({ length: 20 }, (_, i) =>
				makeNode({
					tagName: 'p',
					isVisible: true,
					text: `Para ${i}`,
					children: [],
				}),
			);

			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'body',
						isVisible: true,
						children,
					}),
				],
			});

			const state = small.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('DOM truncated at 5 elements');
		});
	});

	describe('containment threshold (redundant wrappers)', () => {
		test('skips redundant div wrapper when child fills parent', () => {
			const innerButton = makeNode({
				tagName: 'button',
				isVisible: true,
				isInteractive: true,
				highlightIndex: 0 as ElementRef,
				cssSelector: 'button',
				text: 'Click',
				rect: { x: 0, y: 0, width: 200, height: 50 },
			});

			const wrapper = makeNode({
				tagName: 'div',
				isVisible: true,
				isInteractive: false,
				rect: { x: 0, y: 0, width: 200, height: 50 },
				children: [innerButton],
			});

			const root = makeNode({
				tagName: 'html',
				children: [wrapper],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			// The redundant div wrapper should be skipped in output;
			// the button should appear directly
			expect(state.tree).toContain('button');
			expect(state.tree).toContain('Click');
		});

		test('does not skip wrapper when it has a highlightIndex', () => {
			const inner = makeNode({
				tagName: 'span',
				isVisible: true,
				text: 'Text',
				rect: { x: 0, y: 0, width: 100, height: 20 },
			});

			const wrapper = makeNode({
				tagName: 'div',
				isVisible: true,
				highlightIndex: 1 as ElementRef,
				cssSelector: 'div#parent',
				rect: { x: 0, y: 0, width: 100, height: 20 },
				children: [inner],
			});

			const root = makeNode({
				tagName: 'html',
				children: [wrapper],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('<div');
		});

		test('does not skip non-generic tag wrappers', () => {
			const inner = makeNode({
				tagName: 'p',
				isVisible: true,
				text: 'Hello',
				rect: { x: 0, y: 0, width: 100, height: 20 },
			});

			const wrapper = makeNode({
				tagName: 'nav', // not in genericTags set
				isVisible: true,
				rect: { x: 0, y: 0, width: 100, height: 20 },
				children: [inner],
			});

			const root = makeNode({
				tagName: 'html',
				children: [wrapper],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('<nav');
		});
	});

	describe('off-screen element filtering', () => {
		test('filters out elements with degenerate rects (zero area)', () => {
			const zeroWidth = makeNode({
				tagName: 'button',
				isVisible: true,
				isInteractive: true,
				highlightIndex: 0 as ElementRef,
				cssSelector: 'button.hidden',
				rect: { x: 0, y: 0, width: 0, height: 30 },
			});

			const root = makeNode({
				tagName: 'html',
				children: [zeroWidth],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			// Zero-width element should be filtered from the selector map
			expect(state.selectorMap[0]).toBeUndefined();
		});

		test('filters out elements with extreme off-canvas positioning', () => {
			const offCanvas = makeNode({
				tagName: 'a',
				isVisible: true,
				isInteractive: true,
				highlightIndex: 0 as ElementRef,
				cssSelector: 'a.sr-only',
				rect: { x: -10000, y: 0, width: 100, height: 20 },
			});

			const root = makeNode({
				tagName: 'html',
				children: [offCanvas],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.selectorMap[0]).toBeUndefined();
		});

		test('keeps elements that are off-viewport but within document bounds', () => {
			const belowViewport = makeNode({
				tagName: 'button',
				isVisible: true,
				isInteractive: true,
				highlightIndex: 0 as ElementRef,
				cssSelector: 'button.below',
				rect: { x: 100, y: 2000, width: 100, height: 30 },
			});

			const root = makeNode({
				tagName: 'html',
				children: [belowViewport],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			// Should be kept in selector map even though off-viewport
			expect(state.selectorMap[0]).toBeDefined();
			expect(state.selectorMap[0].cssSelector).toBe('button.below');
		});
	});

	describe('hidden element hints formatting', () => {
		test('formats hints for off-screen elements below viewport', () => {
			const belowElement = makeNode({
				tagName: 'button',
				isVisible: true,
				isInteractive: true,
				highlightIndex: 0 as ElementRef,
				cssSelector: 'button.far',
				ariaLabel: 'Load more',
				rect: { x: 100, y: 2400, width: 100, height: 30 },
			});

			const root = makeNode({
				tagName: 'html',
				children: [belowElement],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			expect(state.tree).toContain('Off-screen interactive elements');
			expect(state.tree).toContain('Load more');
			expect(state.tree).toContain('pages below');
		});

		test('formats hints for elements above viewport', () => {
			const aboveElement = makeNode({
				tagName: 'a',
				isVisible: true,
				isInteractive: true,
				highlightIndex: 0 as ElementRef,
				cssSelector: 'a.header',
				ariaLabel: 'Home link',
				rect: { x: 100, y: 50, width: 100, height: 30 },
			});

			const root = makeNode({
				tagName: 'html',
				children: [aboveElement],
			});

			// Scrolled down so element is above
			const state = serializer.serializeTree(
				root,
				{ x: 0, y: 1000 },
				defaultViewport,
				defaultDocSize,
			);

			expect(state.tree).toContain('Home link');
			expect(state.tree).toContain('pages above');
		});

		test('limits hints to 15 off-screen elements', () => {
			const children = Array.from({ length: 20 }, (_, i) =>
				makeNode({
					tagName: 'button',
					isVisible: true,
					isInteractive: true,
					highlightIndex: i as ElementRef,
					cssSelector: `button.item-${i}`,
					ariaLabel: `Button ${i}`,
					rect: { x: 100, y: 2000 + i * 100, width: 100, height: 30 },
				}),
			);

			const root = makeNode({
				tagName: 'html',
				children,
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);

			// Should cap at 15 and say "... and N more"
			expect(state.tree).toContain('more off-screen elements');
		});
	});

	describe('attributes serialization', () => {
		test('includes configured attributes in output', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'input',
						isVisible: true,
						attributes: {
							placeholder: 'Enter email',
							title: 'Email field',
						},
						children: [],
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('placeholder="Enter email"');
			expect(state.tree).toContain('title="Email field"');
		});

		test('includes role and aria-label from node properties', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'div',
						isVisible: true,
						role: 'navigation',
						ariaLabel: 'Main menu',
						attributes: {},
						children: [makeTextNode('Menu')],
					}),
				],
			});

			const state = serializer.serializeTree(root, defaultScroll, defaultViewport, defaultDocSize);
			expect(state.tree).toContain('role="navigation"');
			expect(state.tree).toContain('aria-label="Main menu"');
		});

		test('includes input value in output', () => {
			const root = makeNode({
				tagName: 'html',
				children: [
					makeNode({
						tagName: 'input',
						isVisible: true,
						inputValue: 'current text',
						attributes: {},
						children: [],
					}),
				],
			});
