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
		elementCount: 50,
		textHash: 'texthash1',
		...overrides,
	};
}

// ── Tests ──

describe('StallDetector', () => {
	let detector: StallDetector;

	beforeEach(() => {
		detector = new StallDetector();
	});

	describe('initial state', () => {
		test('isStuck returns not stuck when no actions recorded', () => {
			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
			expect(result.severity).toBe(0);
		});

		test('getTotalRepetitions returns 0 initially', () => {
			expect(detector.getTotalRepetitions()).toBe(0);
		});

		test('getLoopNudgeMessage returns empty string when not stuck', () => {
			expect(detector.getLoopNudgeMessage()).toBe('');
		});
	});

	describe('recordAction and repeated action detection', () => {
		test('does not flag non-repeated actions', () => {
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);
			detector.recordAction([clickAction(3)]);

			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
		});
