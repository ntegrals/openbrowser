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

