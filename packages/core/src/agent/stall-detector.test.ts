import { test, expect, describe, beforeEach } from 'bun:test';
import {
	StallDetector,
	hashPageTree,
	hashTextContent,
	type PageSignature,
} from './stall-detector.js';
import type { Command } from '../commands/types.js';

// ── Helpers ──

function clickAction(index: number): Command {
	return { action: 'tap', index, clickCount: 1 };
}

function inputAction(index: number, text: string): Command {
	return { action: 'type_text', index, text, clearFirst: true };
}

function navigateAction(url: string): Command {
	return { action: 'navigate', url };
}

function scrollAction(direction: 'up' | 'down', index?: number): Command {
	return { action: 'scroll', direction, index };
}

function doneAction(text: string): Command {
	return { action: 'finish', text, success: true };
}

function searchGoogleAction(query: string): Command {
	return { action: 'web_search', query };
}

function makeFingerprint(overrides: Partial<PageSignature> = {}): PageSignature {
	return {
		url: 'https://example.com',
		domHash: 'abc123',
		scrollY: 0,
