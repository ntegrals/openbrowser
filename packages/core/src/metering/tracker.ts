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
 */
export class CompositeUsageMeter {
	private readonly pricing: PricingTable;
	private readonly trackers = new Map<string, UsageMeter>();
	private readonly actionTrace: ActionUsageRecord[] = [];
	private budgetConfig: BudgetPolicy | undefined;
	private crossedThresholds = new Set<number>();
	private startTime: number | undefined;

	constructor(customPricing?: PricingTable) {
		this.pricing = customPricing ?? DEFAULT_COST_RATES;
	}

	/** Start the session timer. Called automatically on first record if not called explicitly. */
	start(): void {
		this.startTime = Date.now();
	}

	/**
	 * Configure budget alerts. Thresholds default to [0.5, 0.8, 1.0].
	 * Returns this for chaining.
	 */
	setBudget(config: BudgetPolicy): this {
		this.budgetConfig = {
			...config,
			thresholds: config.thresholds ?? [0.5, 0.8, 1.0],
		};
		this.crossedThresholds.clear();
		return this;
	}

	/** Clear the budget configuration. */
	clearBudget(): void {
		this.budgetConfig = undefined;
		this.crossedThresholds.clear();
	}

	/**
	 * Record token usage for a specific model and role.
	 * Returns the estimated cost for this single call.
	 * Throws if budget is exhausted and onBudgetExhausted returns false.
	 */
	record(opts: {
		modelId: string;
		role: ModelRole;
		inputTokens: number;
		outputTokens: number;
		stepIndex?: number;
		actionName?: string;
	}): number {
		if (!this.startTime) this.start();

		// Get or create per-model tracker
		const tracker = this.getOrCreateTracker(opts.modelId);
		tracker.record(opts.inputTokens, opts.outputTokens);

		// Compute cost for this call
		const cost = computeCost(opts.inputTokens, opts.outputTokens, opts.modelId, this.pricing);

		// Append to action trace
		const entry: ActionUsageRecord = {
			stepIndex: opts.stepIndex ?? this.actionTrace.length,
			actionName: opts.actionName ?? 'unknown',
			role: opts.role,
			modelId: opts.modelId,
			usage: {
				inputTokens: opts.inputTokens,
				outputTokens: opts.outputTokens,
				totalTokens: opts.inputTokens + opts.outputTokens,
			},
			cost,
			timestamp: Date.now(),
		};
		this.actionTrace.push(entry);

		// Check budget thresholds
		this.checkBudget();

		return cost;
	}

	/** Get the per-model UsageMeter (creates one if missing). */
	getTracker(modelId: string): UsageMeter {
		return this.getOrCreateTracker(modelId);
	}

	/** Total estimated cost across all models. */
	getTotalCost(): number {
		let total = 0;
		for (const tracker of this.trackers.values()) {
			total += tracker.getEstimatedCost();
		}
		return total;
	}

	/** Formatted total cost string. */
	getTotalCostFormatted(): string {
		return `$${this.getTotalCost().toFixed(4)}`;
	}

	/** Aggregate token usage across all models. */
	getTotalUsage(): UsageRecord {
		let inputTokens = 0;
		let outputTokens = 0;
		for (const tracker of this.trackers.values()) {
			const u = tracker.getTotalUsage();
			inputTokens += u.inputTokens;
			outputTokens += u.outputTokens;
		}
		return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
	}

	/** Get the current budget status. */
	getBudgetState(): BudgetState {
		const currentCost = this.getTotalCost();
		const maxCost = this.budgetConfig?.maxCostUsd;

		return {
			currentCostUsd: currentCost,
			maxCostUsd: maxCost,
			fractionUsed: maxCost != null ? currentCost / maxCost : undefined,
			isExhausted: maxCost != null ? currentCost >= maxCost : false,
			crossedThresholds: [...this.crossedThresholds].sort((a, b) => a - b),
		};
	}

	/** Build a full MeteringSummary with per-model and per-role breakdowns. */
	getSummary(): MeteringSummary {
		const totalUsage = this.getTotalUsage();

		return {
			totalInputTokens: totalUsage.inputTokens,
			totalOutputTokens: totalUsage.outputTokens,
			totalTokens: totalUsage.totalTokens,
			totalEstimatedCost: this.getTotalCost(),
			totalCalls: this.actionTrace.length,
			byModel: this.buildModelBreakdown(),
			byRole: this.buildRoleBreakdown(),
			actionTrace: [...this.actionTrace],
			durationMs: this.startTime ? Date.now() - this.startTime : undefined,
		};
	}

	/** Human-readable summary string. */
	getSummaryText(): string {
		const s = this.getSummary();
		const lines: string[] = [
			'=== Token Usage Summary ===',
			`Total: ${s.totalTokens.toLocaleString()} tokens (${s.totalInputTokens.toLocaleString()} in / ${s.totalOutputTokens.toLocaleString()} out)`,
			`Cost: $${s.totalEstimatedCost.toFixed(4)}`,
			`Calls: ${s.totalCalls}`,
		];

		if (s.durationMs != null) {
			lines.push(`Duration: ${(s.durationMs / 1000).toFixed(1)}s`);
		}

		if (s.byRole.length > 0) {
			lines.push('', '--- By Role ---');
			for (const r of s.byRole) {
				lines.push(
					`  ${r.role}: ${r.totalTokens.toLocaleString()} tokens, $${r.estimatedCost.toFixed(4)} (${r.callCount} calls)`,
				);
			}
		}

		if (s.byModel.length > 0) {
			lines.push('', '--- By Model ---');
			for (const m of s.byModel) {
				lines.push(
					`  ${m.modelId}: ${m.totalTokens.toLocaleString()} tokens, $${m.estimatedCost.toFixed(4)} (${m.callCount} calls)`,
				);
			}
		}

		const budget = this.getBudgetState();
		if (budget.maxCostUsd != null) {
			const pct = ((budget.fractionUsed ?? 0) * 100).toFixed(1);
			lines.push(
				'',
