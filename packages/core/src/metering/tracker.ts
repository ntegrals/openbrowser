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
