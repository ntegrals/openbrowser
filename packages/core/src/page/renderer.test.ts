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
