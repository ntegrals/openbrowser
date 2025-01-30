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

		test('flags the same action repeated maxRepeatedActions times (default 3)', () => {
			detector.recordAction([clickAction(5)]);
			detector.recordAction([clickAction(5)]);
			detector.recordAction([clickAction(5)]);

			const result = detector.isStuck();
			expect(result.stuck).toBe(true);
			expect(result.reason).toContain('repeated');
			expect(result.reason).toContain('3');
		});

		test('flags repeated multi-action steps', () => {
			const actions: Command[] = [clickAction(1), inputAction(2, 'hello')];
			detector.recordAction(actions);
			detector.recordAction(actions);
			detector.recordAction(actions);

			const result = detector.isStuck();
			expect(result.stuck).toBe(true);
		});

		test('does not flag when only two repeated actions (below threshold)', () => {
			detector.recordAction([clickAction(5)]);
			detector.recordAction([clickAction(5)]);

			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
		});

		test('custom maxRepeatedActions threshold', () => {
			// With maxRepeatedActions=5, only 5+ trailing repeats should trigger.
			// Note: cycle detection (A->B->A->B) fires with 4 identical actions
			// because all 4 being the same matches the pattern. So we can only test
			// that at exactly 3 trailing repeats (below our custom threshold of 5,
			// and below the cycle check threshold of 4 identical entries), it's not stuck.
			const custom = new StallDetector({ maxRepeatedActions: 5 });
			custom.recordAction([clickAction(10)]); // prefix to avoid cycle match
			custom.recordAction([clickAction(1)]);
			custom.recordAction([clickAction(1)]);
