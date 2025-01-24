import type {
	UsageRecord,
	CostRates,
	PricingTable,
	ModelRole,
	ActionUsageRecord,
	MeteringSummary,
	ModelUsageBreakdown,
	RoleUsageBreakdown,
	BudgetPolicy,
	BudgetState,
} from './types.js';
import { DEFAULT_COST_RATES } from './types.js';

// ── Single-model tracker (unchanged public API) ──

export class UsageMeter {
	private usage: UsageRecord = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
	private pricing: PricingTable;
	private modelId: string;
	private stepUsages: UsageRecord[] = [];

	constructor(modelId: string, customPricing?: PricingTable) {
		this.modelId = modelId;
		this.pricing = customPricing ?? DEFAULT_COST_RATES;
	}

	record(inputTokens: number, outputTokens: number): void {
		const stepUsage: UsageRecord = {
			inputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
		};

		this.usage.inputTokens += inputTokens;
		this.usage.outputTokens += outputTokens;
		this.usage.totalTokens += inputTokens + outputTokens;
		this.stepUsages.push(stepUsage);
	}

	getTotalUsage(): UsageRecord {
		return { ...this.usage };
	}

	getStepUsages(): UsageRecord[] {
		return [...this.stepUsages];
	}

	getEstimatedCost(): number {
		const cost = this.getModelCost();
		if (!cost) return 0;

		return (
			(this.usage.inputTokens / 1_000_000) * cost.inputCostPerMillion +
			(this.usage.outputTokens / 1_000_000) * cost.outputCostPerMillion
		);
	}

	getEstimatedCostFormatted(): string {
		const cost = this.getEstimatedCost();
		return `$${cost.toFixed(4)}`;
	}

	private getModelCost(): CostRates | undefined {
		return resolveModelCost(this.modelId, this.pricing);
	}

	getSummary(): string {
		const lines = [
			`Model: ${this.modelId}`,
			`Steps: ${this.stepUsages.length}`,
			`Input tokens: ${this.usage.inputTokens.toLocaleString()}`,
			`Output tokens: ${this.usage.outputTokens.toLocaleString()}`,
			`Total tokens: ${this.usage.totalTokens.toLocaleString()}`,
			`Estimated cost: ${this.getEstimatedCostFormatted()}`,
		];
		return lines.join('\n');
	}

	reset(): void {
		this.usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
		this.stepUsages = [];
	}
}

// ── Multi-model tracker ──

/**
 * Tracks token usage across multiple LLM roles (main, extraction, judge, compaction)
 * with per-action cost breakdown, budget alerts, and comprehensive summaries.
