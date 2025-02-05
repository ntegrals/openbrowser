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

