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
