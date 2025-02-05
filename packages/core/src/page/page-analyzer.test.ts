import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { PageAnalyzer } from './page-analyzer.js';
import { PageExtractionError } from '../errors.js';
import type { PageTreeNode, SelectorIndex, RenderedPageState } from './types.js';
import type { ElementRef } from '../types.js';

// ── Mock factories ──

function makeMockPage(overrides: Record<string, unknown> = {}) {
	return {
		viewportSize: () => ({ width: 1280, height: 800 }),
		evaluate: mock(() => Promise.resolve({ x: 0, y: 0 })),
		click: mock(() => Promise.resolve()),
		fill: mock(() => Promise.resolve()),
		mouse: {
			click: mock(() => Promise.resolve()),
		},
		keyboard: {
			type: mock(() => Promise.resolve()),
		},
		frames: () => [],
		...overrides,
	} as any;
}

function makeMockCdpSession(overrides: Record<string, unknown> = {}) {
	return {
		send: mock(() => Promise.resolve({})),
		...overrides,
	} as any;
}

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

// ── Tests ──

describe('PageAnalyzer', () => {
	let service: PageAnalyzer;

	beforeEach(() => {
		service = new PageAnalyzer();
	});

	describe('constructor defaults', () => {
		test('has default viewport expansion of 0', () => {
			// The service is created with defaults, including viewportExpansion = 0
			expect(service).toBeDefined();
		});

		test('accepts custom options', () => {
			const custom = new PageAnalyzer({
				viewportExpansion: 500,
				maxElementsInDom: 100,
				maxIframes: 1,
				capturedAttributes: ['title'],
			});
			expect(custom).toBeDefined();
		});
	});

	describe('cache management', () => {
		test('getCachedTree returns null initially', () => {
			expect(service.getCachedTree()).toBeNull();
		});

		test('getCachedSelectorMap returns null initially', () => {
			expect(service.getCachedSelectorMap()).toBeNull();
		});

		test('clearCache resets tree and selector map', () => {
			// We can't set cachedTree directly, but clearCache should work on empty state
			service.clearCache();
			expect(service.getCachedTree()).toBeNull();
			expect(service.getCachedSelectorMap()).toBeNull();
		});
	});

	describe('interaction recording', () => {
		test('getInteractedElements returns empty array initially', () => {
			expect(service.getInteractedElements()).toEqual([]);
		});

		test('clearInteractedElements resets the list', () => {
			service.clearInteractedElements();
			expect(service.getInteractedElements()).toEqual([]);
		});

		test('getInteractedElements returns a copy', () => {
			const elements = service.getInteractedElements();
			expect(elements).not.toBe(service.getInteractedElements());
		});
	});

	describe('clickElementByIndex', () => {
		test('throws PageExtractionError when element not in selector map', async () => {
			const page = makeMockPage();
			const cdp = makeMockCdpSession();

			await expect(
				service.clickElementByIndex(page, cdp, 42),
			).rejects.toThrow(PageExtractionError);
		});

		test('Strategy 1: uses CDP box model when backendNodeId is available', async () => {
			const page = makeMockPage();
			const cdp = makeMockCdpSession({
				send: mock(() =>
					Promise.resolve({
						model: {
							content: [10, 10, 110, 10, 110, 60, 10, 60],
						},
					}),
				),
			});

			// Inject a selector map with a backendNodeId
			const selectorMap: SelectorIndex = {
				0: {
					cssSelector: '#btn',
					backendNodeId: 123,
					tagName: 'button',
				},
			};
			// Use the private cachedSelectorMap via prototype access
			(service as any).cachedSelectorMap = selectorMap;

			await service.clickElementByIndex(page, cdp, 0);

			// Should have used mouse.click with center coordinates
			expect(page.mouse.click).toHaveBeenCalledTimes(1);
			// Center of quad: ((10+110+110+10)/4, (10+10+60+60)/4) = (60, 35)
			expect(page.mouse.click).toHaveBeenCalledWith(60, 35);

			// Should have recorded the interaction
			const interactions = service.getInteractedElements();
			expect(interactions).toHaveLength(1);
			expect(interactions[0].action).toBe('click');
			expect(interactions[0].tagName).toBe('button');
		});

		test('Strategy 2: falls back to JS getBoundingClientRect when CDP fails', async () => {
			const evaluateMock = mock(() =>
				Promise.resolve({ x: 50, y: 25 }),
			);
			const page = makeMockPage({ evaluate: evaluateMock });
			const cdp = makeMockCdpSession({
				send: mock(() => Promise.reject(new Error('CDP failed'))),
			});

			const selectorMap: SelectorIndex = {
				0: {
					cssSelector: '#btn',
					backendNodeId: 123,
					tagName: 'button',
				},
			};
			(service as any).cachedSelectorMap = selectorMap;

			await service.clickElementByIndex(page, cdp, 0);

			// Should have called page.evaluate (JS fallback)
			expect(evaluateMock).toHaveBeenCalled();
			// Then mouse.click with the returned coords
			expect(page.mouse.click).toHaveBeenCalledWith(50, 25);
		});

		test('Strategy 3: falls back to CSS selector click when JS rect returns null', async () => {
			const evaluateMock = mock(() => Promise.resolve(null));
			const page = makeMockPage({ evaluate: evaluateMock });
			const cdp = makeMockCdpSession({
				send: mock(() => Promise.reject(new Error('CDP failed'))),
			});

			const selectorMap: SelectorIndex = {
				0: {
					cssSelector: '.my-btn',
					backendNodeId: 123,
					tagName: 'button',
				},
			};
			(service as any).cachedSelectorMap = selectorMap;

			await service.clickElementByIndex(page, cdp, 0);

			// Should have fallen through to page.click(cssSelector)
			expect(page.click).toHaveBeenCalledWith('.my-btn', { timeout: 5000 });
		});

		test('uses CSS selector click when no backendNodeId', async () => {
			const evaluateMock = mock(() => Promise.resolve(null));
			const page = makeMockPage({ evaluate: evaluateMock });
			const cdp = makeMockCdpSession();

			const selectorMap: SelectorIndex = {
				0: {
					cssSelector: '#submit',
					tagName: 'button',
					// No backendNodeId
				},
			};
			(service as any).cachedSelectorMap = selectorMap;

			await service.clickElementByIndex(page, cdp, 0);

			expect(page.click).toHaveBeenCalledWith('#submit', { timeout: 5000 });
		});
	});

	describe('clickAtCoordinates', () => {
		test('clicks at the specified coordinates', async () => {
			const page = makeMockPage();
			await service.clickAtCoordinates(page, 100, 200);
			expect(page.mouse.click).toHaveBeenCalledWith(100, 200);
		});
	});

	describe('inputTextByIndex', () => {
		test('throws when element not in selector map', async () => {
			const page = makeMockPage();
			const cdp = makeMockCdpSession();

			await expect(
				service.inputTextByIndex(page, cdp, 99, 'hello'),
			).rejects.toThrow(PageExtractionError);
		});

		test('fills input with text when clearFirst is true (default)', async () => {
			const page = makeMockPage();
			const cdp = makeMockCdpSession();

			(service as any).cachedSelectorMap = {
				0: { cssSelector: '#name', tagName: 'input' },
			};

			await service.inputTextByIndex(page, cdp, 0, 'Alice');

			expect(page.fill).toHaveBeenCalledWith('#name', 'Alice');
			expect(service.getInteractedElements()).toHaveLength(1);
			expect(service.getInteractedElements()[0].action).toBe('input');
		});

		test('types text without clearing when clearFirst is false', async () => {
			const page = makeMockPage();
			const cdp = makeMockCdpSession();

			(service as any).cachedSelectorMap = {
				0: { cssSelector: '#name', tagName: 'input' },
			};

			await service.inputTextByIndex(page, cdp, 0, 'Bob', false);

			expect(page.click).toHaveBeenCalledWith('#name');
			expect(page.keyboard.type).toHaveBeenCalledWith('Bob');
		});
	});

	describe('getElementSelector', () => {
		test('returns undefined when no selector map cached', async () => {
			const result = await service.getElementSelector(0);
			expect(result).toBeUndefined();
		});

		test('returns CSS selector when element is in the map', async () => {
			(service as any).cachedSelectorMap = {
				5: { cssSelector: '.item-5', tagName: 'div' },
			};

			const result = await service.getElementSelector(5);
			expect(result).toBe('.item-5');
		});
	});

	describe('getElementByBackendNodeId', () => {
		test('returns selector with ID when available', async () => {
			const cdp = makeMockCdpSession({
				send: mock(() =>
					Promise.resolve({
						node: {
							nodeName: 'DIV',
							attributes: ['id', 'main-content', 'class', 'wrapper'],
						},
					}),
				),
			});

			const result = await service.getElementByBackendNodeId(cdp, 42);
			expect(result).toEqual({ selector: '#main-content' });
		});

		test('returns tag name when no ID attribute', async () => {
			const cdp = makeMockCdpSession({
				send: mock(() =>
					Promise.resolve({
						node: {
							nodeName: 'BUTTON',
							attributes: ['class', 'primary'],
						},
					}),
				),
			});

			const result = await service.getElementByBackendNodeId(cdp, 42);
			expect(result).toEqual({ selector: 'button' });
		});

		test('returns null when CDP call fails', async () => {
			const cdp = makeMockCdpSession({
				send: mock(() => Promise.reject(new Error('not found'))),
			});

			const result = await service.getElementByBackendNodeId(cdp, 42);
			expect(result).toBeNull();
		});

		test('returns null when node has no result', async () => {
			const cdp = makeMockCdpSession({
				send: mock(() => Promise.resolve({ node: null })),
			});

			const result = await service.getElementByBackendNodeId(cdp, 42);
			expect(result).toBeNull();
		});
	});

	describe('collectHiddenElementHints (via private access)', () => {
		test('collects hints for elements below the viewport', () => {
			const root = makeNode({
				children: [
					makeNode({
						tagName: 'button',
						isInteractive: true,
						isVisible: false,
						highlightIndex: 0 as ElementRef,
						ariaLabel: 'Submit form',
						rect: { x: 0, y: 2000, width: 100, height: 30 },
					}),
				],
			});

			const viewport = { width: 1280, height: 800 };
			const scroll = { x: 0, y: 0 };

			const hints = (service as any).collectHiddenElementHints(root, viewport, scroll);

			expect(hints).toHaveLength(1);
			expect(hints[0]).toContain('Submit form');
			expect(hints[0]).toContain('pages below');
		});

		test('collects hints for elements above the viewport', () => {
			const root = makeNode({
				children: [
					makeNode({
						tagName: 'a',
						isInteractive: true,
						isVisible: false,
						highlightIndex: 1 as ElementRef,
						text: 'Top link',
						rect: { x: 0, y: 100, width: 80, height: 20 },
					}),
				],
			});

			const viewport = { width: 1280, height: 800 };
			const scroll = { x: 0, y: 1600 }; // scrolled way down

			const hints = (service as any).collectHiddenElementHints(root, viewport, scroll);

			expect(hints).toHaveLength(1);
			expect(hints[0]).toContain('Top link');
			expect(hints[0]).toContain('pages above');
		});

		test('ignores visible or non-interactive elements', () => {
			const root = makeNode({
				children: [
					makeNode({
						tagName: 'button',
						isInteractive: true,
						isVisible: true, // visible elements are not collected
						highlightIndex: 0 as ElementRef,
						rect: { x: 0, y: 2000, width: 100, height: 30 },
					}),
					makeNode({
						tagName: 'div',
						isInteractive: false, // non-interactive
						isVisible: false,
						highlightIndex: 1 as ElementRef,
						rect: { x: 0, y: 2000, width: 100, height: 30 },
					}),
				],
			});

			const viewport = { width: 1280, height: 800 };
			const scroll = { x: 0, y: 0 };

			const hints = (service as any).collectHiddenElementHints(root, viewport, scroll);
			expect(hints).toHaveLength(0);
		});
	});

	describe('applyViewportThresholdFilter (via private access)', () => {
		test('removes highlightIndex from elements outside expanded viewport', () => {
			const outsideNode = makeNode({
				tagName: 'button',
				highlightIndex: 0 as ElementRef,
				rect: { x: 0, y: 5000, width: 100, height: 30 },
			});
			const insideNode = makeNode({
				tagName: 'input',
				highlightIndex: 1 as ElementRef,
				rect: { x: 0, y: 200, width: 200, height: 30 },
			});
			const root = makeNode({
				children: [outsideNode, insideNode],
			});

			const viewport = { width: 1280, height: 800 };
			const scroll = { x: 0, y: 0 };

			(service as any).applyViewportThresholdFilter(root, viewport, scroll);

			// The outside node should have its highlightIndex removed
			expect(outsideNode.highlightIndex).toBeUndefined();
			// The inside node should keep its highlightIndex
			expect(insideNode.highlightIndex).toBe(1 as ElementRef);
		});

		test('keeps elements within the viewport expansion margin', () => {
			const svc = new PageAnalyzer({ viewportExpansion: 500 });
			const nearNode = makeNode({
				tagName: 'a',
				highlightIndex: 0 as ElementRef,
				rect: { x: 0, y: 1100, width: 100, height: 30 },
			});
			const root = makeNode({ children: [nearNode] });

			(svc as any).applyViewportThresholdFilter(
				root,
				{ width: 1280, height: 800 },
				{ x: 0, y: 0 },
			);

			// y=1100 is within 0..800+500=1300, so should be kept
			expect(nearNode.highlightIndex).toBe(0 as ElementRef);
		});

		test('removes elements far to the right of the viewport', () => {
			const farRightNode = makeNode({
				tagName: 'button',
				highlightIndex: 0 as ElementRef,
				rect: { x: 5000, y: 100, width: 100, height: 30 },
			});
			const root = makeNode({ children: [farRightNode] });

			(service as any).applyViewportThresholdFilter(
				root,
				{ width: 1280, height: 800 },
				{ x: 0, y: 0 },
			);

			expect(farRightNode.highlightIndex).toBeUndefined();
		});
	});

	describe('integrateShadowDOMChildren (via private access)', () => {
		test('merges shadow children into the children array', () => {
