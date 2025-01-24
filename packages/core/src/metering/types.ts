export interface UsageRecord {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface CostRates {
	inputCostPerMillion: number;
	outputCostPerMillion: number;
}

export interface PricingTable {
	[modelId: string]: CostRates;
}

/**
 * Role that a model can serve in the agent pipeline.
 * - main: primary reasoning / action-selection model
 * - extraction: lightweight model for page content extraction
 * - judge: evaluates task completion
 * - compaction: summarizes / compresses conversation history
 */
export type ModelRole = 'main' | 'extraction' | 'judge' | 'compaction';

/** Token usage attributed to a single agent action (step). */
export interface ActionUsageRecord {
	stepIndex: number;
	actionName: string;
	role: ModelRole;
	modelId: string;
	usage: UsageRecord;
	cost: number;
	timestamp: number;
}

/** Per-model aggregated usage. */
export interface ModelUsageBreakdown {
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedCost: number;
	callCount: number;
}

/** Per-role aggregated usage. */
export interface RoleUsageBreakdown {
	role: ModelRole;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedCost: number;
	callCount: number;
}

/** Comprehensive usage summary across all models and roles. */
export interface MeteringSummary {
	/** Aggregate across everything. */
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	totalEstimatedCost: number;
	totalCalls: number;

	/** Breakdown by model ID. */
	byModel: ModelUsageBreakdown[];

	/** Breakdown by role. */
	byRole: RoleUsageBreakdown[];

	/** Per-action cost trace (chronological). */
	actionTrace: ActionUsageRecord[];

	/** Wall-clock duration of the tracked session in ms (if available). */
	durationMs?: number;
}

/** Configuration for budget alerts. */
export interface BudgetPolicy {
	/** Maximum allowed cost in USD. */
	maxCostUsd: number;

	/**
	 * Warning thresholds as fractions of maxCostUsd (e.g. [0.5, 0.8, 1.0]).
	 * Callbacks fire when cost first crosses each threshold.
	 */
	thresholds?: number[];

	/** Called each time a threshold is crossed. */
	onThresholdCrossed: (currentCost: number, threshold: number, maxCost: number) => void;

	/** Called when the budget is fully exhausted. Return true to allow continuing. */
	onBudgetExhausted?: (currentCost: number, maxCost: number) => boolean;
}

/** Status of budget consumption. */
export interface BudgetState {
	currentCostUsd: number;
	maxCostUsd: number | undefined;
	/** Fraction 0..1+ of budget consumed. undefined if no budget set. */
	fractionUsed: number | undefined;
	isExhausted: boolean;
	crossedThresholds: number[];
}

// ── Comprehensive default pricing ──

export const DEFAULT_COST_RATES: PricingTable = {
	// OpenAI
	'gpt-4o': { inputCostPerMillion: 2.5, outputCostPerMillion: 10.0 },
	'gpt-4o-mini': { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
	'gpt-4-turbo': { inputCostPerMillion: 10.0, outputCostPerMillion: 30.0 },
	'gpt-4.5-preview': { inputCostPerMillion: 75.0, outputCostPerMillion: 150.0 },
	'o1': { inputCostPerMillion: 15.0, outputCostPerMillion: 60.0 },
	'o1-mini': { inputCostPerMillion: 3.0, outputCostPerMillion: 12.0 },
	'o1-preview': { inputCostPerMillion: 15.0, outputCostPerMillion: 60.0 },
	'o3-mini': { inputCostPerMillion: 1.1, outputCostPerMillion: 4.4 },

	// Anthropic
	'claude-3-5-sonnet': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
	'claude-3-5-haiku': { inputCostPerMillion: 0.8, outputCostPerMillion: 4.0 },
	'claude-3-opus': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
	'claude-3-haiku': { inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },
	'claude-4-sonnet': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
	'claude-4-opus': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },

	// Google
	'gemini-1.5-pro': { inputCostPerMillion: 1.25, outputCostPerMillion: 5.0 },
	'gemini-1.5-flash': { inputCostPerMillion: 0.075, outputCostPerMillion: 0.3 },
	'gemini-2.0-flash': { inputCostPerMillion: 0.1, outputCostPerMillion: 0.4 },
	'gemini-2.0-pro': { inputCostPerMillion: 1.25, outputCostPerMillion: 5.0 },
	'gemini-2.5-pro': { inputCostPerMillion: 1.25, outputCostPerMillion: 10.0 },
	'gemini-2.5-flash': { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },

	// Mistral
	'mistral-large': { inputCostPerMillion: 2.0, outputCostPerMillion: 6.0 },
	'mistral-small': { inputCostPerMillion: 0.2, outputCostPerMillion: 0.6 },
	'codestral': { inputCostPerMillion: 0.3, outputCostPerMillion: 0.9 },

	// DeepSeek
	'deepseek-chat': { inputCostPerMillion: 0.14, outputCostPerMillion: 0.28 },
	'deepseek-reasoner': { inputCostPerMillion: 0.55, outputCostPerMillion: 2.19 },
};
