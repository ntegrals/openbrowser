import { test, expect, describe, beforeEach, mock } from 'bun:test';
import {
	UsageMeter,
	CompositeUsageMeter,
	BudgetDepletedError,
	estimateTokenCount,
} from './tracker.js';
import type { PricingTable } from './types.js';

// ── Shared pricing for predictable cost calculations ──

const TEST_PRICING: PricingTable = {
	'gpt-4o': { inputCostPerMillion: 2.5, outputCostPerMillion: 10.0 },
	'gpt-4o-mini': { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
	'claude-3-5-sonnet': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
};

// ── UsageMeter ──

describe('UsageMeter', () => {
	let tracker: UsageMeter;

	beforeEach(() => {
		tracker = new UsageMeter('gpt-4o', TEST_PRICING);
	});

	describe('record and getTotalUsage', () => {
		test('records token usage and returns totals', () => {
			tracker.record(100, 50);

			const usage = tracker.getTotalUsage();
			expect(usage.inputTokens).toBe(100);
			expect(usage.outputTokens).toBe(50);
			expect(usage.totalTokens).toBe(150);
		});

		test('accumulates across multiple records', () => {
			tracker.record(100, 50);
			tracker.record(200, 100);
			tracker.record(300, 150);

			const usage = tracker.getTotalUsage();
			expect(usage.inputTokens).toBe(600);
			expect(usage.outputTokens).toBe(300);
			expect(usage.totalTokens).toBe(900);
		});

		test('returns a copy of usage object', () => {
			tracker.record(100, 50);
			const usage1 = tracker.getTotalUsage();
			const usage2 = tracker.getTotalUsage();
			expect(usage1).not.toBe(usage2);
			expect(usage1).toEqual(usage2);
		});
	});

	describe('getEstimatedCost', () => {
		test('computes correct cost for gpt-4o', () => {
			// gpt-4o: $2.50/M input, $10.00/M output
			tracker.record(1_000_000, 500_000);

			const cost = tracker.getEstimatedCost();
			// input: 1M * 2.5/M = 2.5; output: 0.5M * 10/M = 5.0
			expect(cost).toBeCloseTo(7.5, 4);
		});

		test('returns 0 for unknown model', () => {
			const unknown = new UsageMeter('unknown-model', TEST_PRICING);
			unknown.record(1000, 500);

			expect(unknown.getEstimatedCost()).toBe(0);
		});

		test('formats cost as dollar string', () => {
			tracker.record(100_000, 50_000);
			const formatted = tracker.getEstimatedCostFormatted();
			expect(formatted).toMatch(/^\$\d+\.\d{4}$/);
		});
	});

	describe('getStepUsages', () => {
		test('tracks per-step usage', () => {
			tracker.record(100, 50);
			tracker.record(200, 100);

			const steps = tracker.getStepUsages();
			expect(steps).toHaveLength(2);
			expect(steps[0]).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
			expect(steps[1]).toEqual({ inputTokens: 200, outputTokens: 100, totalTokens: 300 });
		});

		test('returns a copy of step usages array', () => {
			tracker.record(100, 50);
			const steps1 = tracker.getStepUsages();
			const steps2 = tracker.getStepUsages();
			expect(steps1).not.toBe(steps2);
		});
	});

	describe('getSummary', () => {
		test('returns formatted summary string', () => {
			tracker.record(1000, 500);

			const summary = tracker.getSummary();
			expect(summary).toContain('Model: gpt-4o');
			expect(summary).toContain('Steps: 1');
			expect(summary).toContain('Input tokens:');
			expect(summary).toContain('Output tokens:');
			expect(summary).toContain('Total tokens:');
			expect(summary).toContain('Estimated cost: $');
		});
	});

	describe('reset', () => {
		test('resets all usage data', () => {
			tracker.record(1000, 500);
			tracker.record(2000, 1000);

			tracker.reset();

			const usage = tracker.getTotalUsage();
			expect(usage.inputTokens).toBe(0);
			expect(usage.outputTokens).toBe(0);
			expect(usage.totalTokens).toBe(0);
			expect(tracker.getStepUsages()).toHaveLength(0);
			expect(tracker.getEstimatedCost()).toBe(0);
		});
	});

	describe('partial model matching', () => {
		test('matches model by partial ID', () => {
			// "gpt-4o" pricing should match "gpt-4o-2024-08-06" via partial match
			const versioned = new UsageMeter('gpt-4o-2024-08-06', TEST_PRICING);
			versioned.record(1_000_000, 0);

			// Should find gpt-4o pricing ($2.50/M input)
			expect(versioned.getEstimatedCost()).toBeCloseTo(2.5, 4);
		});
	});
});

// ── CompositeUsageMeter ──

describe('CompositeUsageMeter', () => {
	let multiTracker: CompositeUsageMeter;

	beforeEach(() => {
		multiTracker = new CompositeUsageMeter(TEST_PRICING);
	});

	describe('record and getTotalUsage', () => {
		test('records usage for a single model', () => {
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 1000,
				outputTokens: 500,
			});

			const usage = multiTracker.getTotalUsage();
			expect(usage.inputTokens).toBe(1000);
			expect(usage.outputTokens).toBe(500);
			expect(usage.totalTokens).toBe(1500);
		});

		test('aggregates across multiple models', () => {
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 1000,
				outputTokens: 500,
			});
			multiTracker.record({
				modelId: 'gpt-4o-mini',
				role: 'extraction',
				inputTokens: 2000,
				outputTokens: 800,
			});

			const usage = multiTracker.getTotalUsage();
			expect(usage.inputTokens).toBe(3000);
			expect(usage.outputTokens).toBe(1300);
			expect(usage.totalTokens).toBe(4300);
		});

		test('returns estimated cost for the recorded call', () => {
			const cost = multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 1_000_000,
				outputTokens: 0,
			});

			// gpt-4o: $2.50/M input
			expect(cost).toBeCloseTo(2.5, 4);
		});
	});

	describe('getTotalCost', () => {
		test('sums costs across all models', () => {
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 1_000_000,
				outputTokens: 0,
			});
			multiTracker.record({
				modelId: 'gpt-4o-mini',
				role: 'extraction',
				inputTokens: 1_000_000,
				outputTokens: 0,
			});

			const totalCost = multiTracker.getTotalCost();
			// gpt-4o: $2.50; gpt-4o-mini: $0.15
			expect(totalCost).toBeCloseTo(2.65, 4);
		});

		test('formats total cost', () => {
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 100_000,
				outputTokens: 50_000,
			});

			const formatted = multiTracker.getTotalCostFormatted();
			expect(formatted).toMatch(/^\$\d+\.\d{4}$/);
		});
	});

	describe('getTracker', () => {
		test('returns per-model tracker', () => {
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 500,
				outputTokens: 200,
			});

			const tracker = multiTracker.getTracker('gpt-4o');
			expect(tracker.getTotalUsage().inputTokens).toBe(500);
		});

		test('creates tracker on first access', () => {
			const tracker = multiTracker.getTracker('claude-3-5-sonnet');
			expect(tracker).toBeDefined();
			expect(tracker.getTotalUsage().totalTokens).toBe(0);
		});
	});

	describe('budget alerts', () => {
		test('fires threshold callback when cost crosses threshold', () => {
			const thresholdCrossed = mock(() => {});
			multiTracker.setBudget({
				maxCostUsd: 1.0,
				thresholds: [0.5, 0.8, 1.0],
				onThresholdCrossed: thresholdCrossed,
			});

			// Record enough to cross 0.5 threshold ($0.50)
			// gpt-4o: $2.50/M input -> need 200k tokens for $0.50
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 200_000,
				outputTokens: 0,
			});

			expect(thresholdCrossed).toHaveBeenCalledTimes(1);
			const call = (thresholdCrossed as any).mock.calls[0];
			expect(call[1]).toBe(0.5); // threshold
			expect(call[2]).toBe(1.0); // maxCost
		});

		test('fires multiple thresholds as cost increases', () => {
			const thresholdCrossed = mock(() => {});
			multiTracker.setBudget({
				maxCostUsd: 1.0,
				thresholds: [0.5, 1.0],
				onThresholdCrossed: thresholdCrossed,
			});

			// Cross 0.5 threshold
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 200_000,
				outputTokens: 0,
			});

			// Cross 1.0 threshold
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 200_000,
				outputTokens: 0,
			});

			expect(thresholdCrossed).toHaveBeenCalledTimes(2);
		});

		test('does not fire same threshold twice', () => {
			const thresholdCrossed = mock(() => {});
			multiTracker.setBudget({
				maxCostUsd: 1.0,
				thresholds: [0.5],
				onThresholdCrossed: thresholdCrossed,
			});

			// Cross 0.5 threshold twice
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 200_000,
				outputTokens: 0,
			});
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 10_000,
				outputTokens: 0,
			});

			expect(thresholdCrossed).toHaveBeenCalledTimes(1);
		});

		test('throws BudgetDepletedError when budget exceeded and callback returns false', () => {
			multiTracker.setBudget({
				maxCostUsd: 0.01,
				thresholds: [1.0],
				onThresholdCrossed: () => {},
				onBudgetExhausted: () => false,
			});

			expect(() =>
				multiTracker.record({
					modelId: 'gpt-4o',
					role: 'main',
					inputTokens: 1_000_000,
					outputTokens: 0,
				}),
			).toThrow(BudgetDepletedError);
		});

		test('allows continuing when onBudgetExhausted returns true', () => {
			multiTracker.setBudget({
				maxCostUsd: 0.01,
				thresholds: [1.0],
				onThresholdCrossed: () => {},
				onBudgetExhausted: () => true,
			});

			expect(() =>
				multiTracker.record({
					modelId: 'gpt-4o',
					role: 'main',
					inputTokens: 1_000_000,
					outputTokens: 0,
				}),
			).not.toThrow();
		});

		test('getBudgetState reflects current state', () => {
			multiTracker.setBudget({
				maxCostUsd: 10.0,
				thresholds: [0.5],
				onThresholdCrossed: () => {},
			});

			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 1_000_000,
				outputTokens: 0,
			});

			const status = multiTracker.getBudgetState();
			expect(status.maxCostUsd).toBe(10.0);
			expect(status.currentCostUsd).toBeCloseTo(2.5, 2);
			expect(status.fractionUsed).toBeCloseTo(0.25, 2);
			expect(status.isExhausted).toBe(false);
		});

		test('clearBudget removes budget configuration', () => {
			multiTracker.setBudget({
				maxCostUsd: 1.0,
				thresholds: [0.5],
				onThresholdCrossed: () => {},
			});

			multiTracker.clearBudget();

			const status = multiTracker.getBudgetState();
			expect(status.maxCostUsd).toBeUndefined();
			expect(status.fractionUsed).toBeUndefined();
			expect(status.isExhausted).toBe(false);
		});
	});

	describe('MeteringSummary generation', () => {
		test('generates comprehensive summary', () => {
			multiTracker.record({
				modelId: 'gpt-4o',
				role: 'main',
				inputTokens: 1000,
				outputTokens: 500,
				stepIndex: 0,
				actionName: 'tap',
			});
			multiTracker.record({
				modelId: 'gpt-4o-mini',
				role: 'extraction',
				inputTokens: 2000,
				outputTokens: 300,
				stepIndex: 1,
				actionName: 'extract',
			});

			const summary = multiTracker.getSummary();

			expect(summary.totalInputTokens).toBe(3000);
			expect(summary.totalOutputTokens).toBe(800);
			expect(summary.totalTokens).toBe(3800);
			expect(summary.totalCalls).toBe(2);
			expect(summary.totalEstimatedCost).toBeGreaterThan(0);

			// By model breakdown
			expect(summary.byModel).toHaveLength(2);
			const gpt4o = summary.byModel.find((m) => m.modelId === 'gpt-4o');
			expect(gpt4o).toBeDefined();
			expect(gpt4o!.inputTokens).toBe(1000);
			expect(gpt4o!.callCount).toBe(1);

			// By role breakdown
			expect(summary.byRole).toHaveLength(2);
			const mainRole = summary.byRole.find((r) => r.role === 'main');
			expect(mainRole).toBeDefined();
			expect(mainRole!.callCount).toBe(1);

