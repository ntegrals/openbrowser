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
