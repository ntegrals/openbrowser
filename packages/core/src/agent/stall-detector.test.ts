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
			custom.recordAction([clickAction(1)]);
			// 3 trailing repeats < 5 threshold, and cycle check sees [10,1,1,1] which is not A->B->A->B
			expect(custom.isStuck().stuck).toBe(false);

			// Add two more to reach 5 trailing repeats
			custom.recordAction([clickAction(1)]);
			custom.recordAction([clickAction(1)]);
			expect(custom.isStuck().stuck).toBe(true);
		});
	});

	describe('action cycle detection (A -> B -> A -> B)', () => {
		test('detects alternating two-action cycle', () => {
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);

			const result = detector.isStuck();
			expect(result.stuck).toBe(true);
			expect(result.reason).toContain('cycle');
		});

		test('does not falsely detect A -> B -> A -> C as a cycle', () => {
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(3)]);

			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
		});
	});

	describe('triple cycle detection (A -> B -> C -> A -> B -> C)', () => {
		test('detects 3-step cycle', () => {
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);
			detector.recordAction([clickAction(3)]);
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);
			detector.recordAction([clickAction(3)]);

			const result = detector.isStuck();
			expect(result.stuck).toBe(true);
			expect(result.reason).toContain('3-step');
		});

		test('does not detect partial triple cycle', () => {
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);
			detector.recordAction([clickAction(3)]);
			detector.recordAction([clickAction(1)]);
			detector.recordAction([clickAction(2)]);

			// Only 5 entries, needs 6 for triple check
			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
		});
	});

	describe('fingerprint-based stuck detection', () => {
		test('detects repeated page fingerprints', () => {
			const fp = makeFingerprint();
			detector.recordFingerprint(fp);
			detector.recordFingerprint(fp);
			detector.recordFingerprint(fp);

			const result = detector.isStuck();
			expect(result.stuck).toBe(true);
			expect(result.reason).toContain('Page state unchanged');
		});

		test('different fingerprints do not trigger stuck', () => {
			detector.recordFingerprint(makeFingerprint({ domHash: 'hash1' }));
			detector.recordFingerprint(makeFingerprint({ domHash: 'hash2' }));
			detector.recordFingerprint(makeFingerprint({ domHash: 'hash3' }));

			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
		});

		test('scroll position bucketed (200px buckets) - same bucket triggers stuck', () => {
			// scrollY 0 and 100 are in the same bucket (both floor to 0)
			detector.recordFingerprint(makeFingerprint({ scrollY: 0 }));
			detector.recordFingerprint(makeFingerprint({ scrollY: 50 }));
			detector.recordFingerprint(makeFingerprint({ scrollY: 100 }));

			const result = detector.isStuck();
			expect(result.stuck).toBe(true);
		});

		test('different scroll buckets not considered stuck', () => {
			detector.recordFingerprint(makeFingerprint({ scrollY: 0 }));
			detector.recordFingerprint(makeFingerprint({ scrollY: 200 }));
			detector.recordFingerprint(makeFingerprint({ scrollY: 400 }));

			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
		});

		test('custom maxRepeatedFingerprints threshold', () => {
			const custom = new StallDetector({ maxRepeatedFingerprints: 5 });
			const fp = makeFingerprint();
			for (let i = 0; i < 4; i++) {
				custom.recordFingerprint(fp);
			}
			expect(custom.isStuck().stuck).toBe(false);

			custom.recordFingerprint(fp);
			expect(custom.isStuck().stuck).toBe(true);
		});
	});

	describe('consecutive stagnant pages detection', () => {
		test('detects stagnant pages with same URL and similar element count', () => {
			const detector5 = new StallDetector({ maxStagnantPages: 5 });
			for (let i = 0; i < 5; i++) {
				// Different domHash/scrollY so fingerprint hashing is distinct,
				// but same URL and elementCount triggers stagnant detection.
				detector5.recordFingerprint(
					makeFingerprint({
						domHash: `hash_${i}`,
						scrollY: i * 200,
						elementCount: 50,
					}),
				);
			}

			const result = detector5.isStuck();
			expect(result.stuck).toBe(true);
			expect(result.reason).toContain('stagnant');
		});

		test('different URLs do not trigger stagnant detection', () => {
			for (let i = 0; i < 5; i++) {
				detector.recordFingerprint(
					makeFingerprint({
						url: `https://example.com/page${i}`,
						domHash: `hash_${i}`,
						scrollY: i * 200,
						elementCount: 50,
					}),
				);
			}

			const result = detector.isStuck();
			expect(result.stuck).toBe(false);
		});
	});

	describe('escalating nudge messages', () => {
		test('severity 0 for repetitions below 5', () => {
			// 3 repetitions -> gets flagged as stuck but severity 0
			for (let i = 0; i < 3; i++) {
				detector.recordAction([clickAction(1)]);
			}
			const result = detector.isStuck();
			expect(result.stuck).toBe(true);
			expect(result.severity).toBe(0);
		});

		test('severity 1 at 5+ total repetitions via cycle detection', () => {
			// Cycle detection path uses getSeverity(this.totalRepetitions)
			// so accumulating enough totalRepetitions can reach severity 1.
			const det = new StallDetector({ maxRepeatedActions: 3 });

			// First: accumulate 3 via repeated actions
			for (let i = 0; i < 3; i++) {
				det.recordAction([clickAction(1)]);
			}
			det.isStuck(); // totalRepetitions += 3

			// Break the trailing sequence, then trigger a 2-cycle
			det.recordAction([clickAction(10)]);
			// A->B->A->B cycle adds 2 to totalRepetitions -> total 5
			det.recordAction([clickAction(20)]);
			det.recordAction([clickAction(10)]);
			det.recordAction([clickAction(20)]);
			const result = det.isStuck();
			expect(result.stuck).toBe(true);
			// totalRepetitions = 3 + 2 = 5, getSeverity(5) = 1
			expect(result.severity).toBe(1);
		});

		test('nudge message contains appropriate text', () => {
			for (let i = 0; i < 3; i++) {
				detector.recordAction([clickAction(1)]);
			}
			const msg = detector.getLoopNudgeMessage();
			expect(msg).toContain('Warning:');
			expect(msg.length).toBeGreaterThan(0);
		});
	});

	describe('action hash normalization', () => {
		test('click actions normalized by index only', () => {
			// Two click actions with same index but different click counts
			// should both normalize to "click:5"
			const d1 = new StallDetector();
			const d2 = new StallDetector();

			const act1: Command = { action: 'tap', index: 5, clickCount: 1 };
			const act2: Command = { action: 'tap', index: 5, clickCount: 2 };

			// Record 3 of each in separate detectors
			for (let i = 0; i < 3; i++) {
				d1.recordAction([act1]);
				d2.recordAction([act2]);
			}

			// Both should detect as stuck since click is normalized by index
			expect(d1.isStuck().stuck).toBe(true);
			expect(d2.isStuck().stuck).toBe(true);
		});

		test('search queries normalized for order independence', () => {
			// "best pizza NYC" and "NYC best pizza" should produce same hash
			const d = new StallDetector();
			d.recordAction([searchGoogleAction('best pizza NYC')]);
			d.recordAction([searchGoogleAction('NYC best pizza')]);
			d.recordAction([searchGoogleAction('pizza best NYC')]);

			expect(d.isStuck().stuck).toBe(true);
		});

		test('different navigate URLs not considered same action', () => {
			detector.recordAction([navigateAction('https://a.com')]);
			detector.recordAction([navigateAction('https://b.com')]);
			detector.recordAction([navigateAction('https://c.com')]);

			expect(detector.isStuck().stuck).toBe(false);
		});

		test('scroll actions include direction and index', () => {
			// Same direction, same index -> stuck
			for (let i = 0; i < 3; i++) {
				detector.recordAction([scrollAction('down', 1)]);
			}
			expect(detector.isStuck().stuck).toBe(true);
		});

		test('done actions include text prefix', () => {
			detector.recordAction([doneAction('Task completed successfully')]);
			detector.recordAction([doneAction('Task completed successfully')]);
			detector.recordAction([doneAction('Task completed successfully')]);

			expect(detector.isStuck().stuck).toBe(true);
		});
	});

	describe('reset', () => {
		test('clears all history and repetitions', () => {
			for (let i = 0; i < 3; i++) {
				detector.recordAction([clickAction(1)]);
				detector.recordFingerprint(makeFingerprint());
			}
			expect(detector.isStuck().stuck).toBe(true);

			detector.reset();

			expect(detector.isStuck().stuck).toBe(false);
			expect(detector.getTotalRepetitions()).toBe(0);
			expect(detector.getLoopNudgeMessage()).toBe('');
		});
	});

	describe('window size pruning', () => {
		test('keeps action history within bounds', () => {
			const smallWindow = new StallDetector({ windowSize: 5 });

			// Record 15 unique actions, then 3 repeated
			for (let i = 0; i < 15; i++) {
				smallWindow.recordAction([clickAction(i)]);
			}

			// Now repeat same action 3 times
			for (let i = 0; i < 3; i++) {
				smallWindow.recordAction([clickAction(99)]);
			}
