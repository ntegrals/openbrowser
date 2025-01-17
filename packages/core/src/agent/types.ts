import { z } from 'zod';
import type { Command, CommandResult } from '../commands/types.js';
import type { ViewportSnapshot, ViewportHistory } from '../viewport/types.js';
import type { InferenceUsage } from '../model/types.js';

// ── Agent Settings ──

export interface AgentConfig {
	task: string;
	stepLimit: number;
	commandsPerStep: number;
	failureThreshold: number;
	retryDelay: number;
	enableScreenshots: boolean;
	enableScreenshotsForTextExtraction: boolean;
	contextWindowSize: number;
	capturedAttributes: string[];
	commandDelayMs: number;
	allowedUrls?: string[];
	blockedUrls?: string[];
	traceOutputPath?: string;
	replayOutputPath?: string;
	strategyInterval: number;
	maskedValues?: Record<string, string>;
	overrideInstructionBuilder?: string;
	extendInstructionBuilder?: string;
	inlineCommands: boolean;
	conversationCompaction?: CompactionPolicy;

	// Extended thinking
	enableDeepReasoning: boolean;
	reasoningBudget: number;

	// Flash mode
	compactMode: boolean;

	// Timeouts (0 = no timeout)
	stepDeadlineMs: number;
	modelDeadlineMs: number;

	// Planning system
	enableStrategy: boolean;
	restrategizeOnStall: boolean;

	// URL extraction from task text
	autoNavigateToUrls: boolean;

	// Coordinate clicking auto-enable per model
	autoEnableCoordinateClicking: boolean;

	// Judge integration
	enableEvaluation: boolean;
	enableSimpleJudge: boolean;
	expectedOutcome?: string;

	// Demo mode
	enableVisualTracer: boolean;

	// Initial actions before main loop
	preflightCommands: Command[];

	// Save conversation per step
	conversationOutputPath?: string;

	// Dynamic action schema rebuild per step
	dynamicCommandSchema: boolean;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
	task: '',
	stepLimit: 100,
	commandsPerStep: 10,
	failureThreshold: 5,
	retryDelay: 10,
	enableScreenshots: true,
	enableScreenshotsForTextExtraction: false,
	contextWindowSize: 128000,
	capturedAttributes: [
		'title', 'type', 'name', 'role', 'tabindex',
		'aria-label', 'placeholder', 'value', 'alt', 'aria-expanded',
	],
	commandDelayMs: 1,
	strategyInterval: 0,
	inlineCommands: true,

	enableDeepReasoning: false,
	reasoningBudget: 10000,
	compactMode: false,
	stepDeadlineMs: 0,
	modelDeadlineMs: 0,
	enableStrategy: false,
	restrategizeOnStall: false,
	autoNavigateToUrls: true,
	autoEnableCoordinateClicking: false,
	enableEvaluation: false,
	enableSimpleJudge: false,
	enableVisualTracer: false,
	preflightCommands: [],
	dynamicCommandSchema: false,
};

// ── Message Compaction Settings ──

export interface CompactionPolicy {
	/** Run LLM-based compaction every N steps (0 = disabled). */
	interval: number;
	/** Model ID to use for summarization. If omitted, uses the agent's main model. */
	model?: string;
	/** Max tokens for the compaction summary output. */
	maxTokens: number;
	/** Target token budget after compaction. Defaults to 60% of contextWindowSize. */
	targetTokens?: number;
}

// ── Agent Brain (LLM thought process) ──

export const ReasoningSchema = z.object({
	evaluation: z.string().describe('Assessment of the current state'),
	memory: z.string().describe('Important information to remember'),
	nextGoal: z.string().describe('Next immediate goal'),
});

export type Reasoning = z.infer<typeof ReasoningSchema>;

// ── Agent Output (what LLM returns each step) ──

export const AgentDecisionSchema = z.object({
	currentState: ReasoningSchema,
	actions: z.array(z.record(z.unknown())).describe('Actions to execute'),
	thinking: z.string().optional().describe('Extended thinking / chain-of-thought'),
	evaluation: z.string().optional().describe('Top-level evaluation (mirrors currentState.evaluation for convenience)'),
	memory: z.string().optional().describe('Top-level memory note (mirrors currentState.memory for convenience)'),
	nextGoal: z.string().optional().describe('Top-level next goal (mirrors currentState.nextGoal for convenience)'),
});

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

/**
 * Simplified output schema for flash / lightweight models that skip extended thinking.
 * Only contains the essential fields: current state evaluation + actions.
 */
export const AgentDecisionCompactSchema = z.object({
	currentState: z.object({
		evaluation: z.string().describe('Brief assessment'),
		nextGoal: z.string().describe('Next immediate goal'),
	}),
	actions: z.array(z.record(z.unknown())).describe('Actions to execute'),
});

export type AgentDecisionCompact = z.infer<typeof AgentDecisionCompactSchema>;

/**
 * Output variant that omits the extended thinking field.
 * Used when the model does not support or should not produce chain-of-thought.
 */
export const AgentDecisionDirectSchema = z.object({
	currentState: ReasoningSchema,
	actions: z.array(z.record(z.unknown())).describe('Actions to execute'),
});

export type AgentDecisionDirect = z.infer<typeof AgentDecisionDirectSchema>;

// ── Step Metadata ──

export interface StepTelemetry {
	/** Step number (1-based). */
	stepNumber: number;
	/** Wall-clock duration of this step in milliseconds. */
	durationMs: number;
	/** Token usage for this step. */
	inputTokens: number;
	outputTokens: number;
	/** Number of actions attempted in this step. */
	actionCount: number;
	/** URL at the start of this step. */
	url?: string;
	/** Path to screenshot file if one was saved. */
	screenshotPath?: string;
	/** Timestamp when the step started. */
	startedAt: number;
	/** Timestamp when the step completed. */
	completedAt: number;
}

// ── Detected Variable ──

/**
 * A variable or piece of data detected during agent execution,
 * e.g. a confirmation number, order ID, or extracted value.
 */
export interface ExtractedVariable {
	/** Human-readable name (e.g. "order_id", "confirmation_number"). */
	name: string;
	/** The detected value as a string. */
	value: string;
	/** Where this variable was found. */
	source: 'extraction' | 'action_result' | 'page_content' | 'user_input';
	/** Step number where this variable was detected. */
	step?: number;
}

// ── Agent State ──

export interface AgentState {
	step: number;
	stepLimit: number;
	failureCount: number;
	consecutiveFailures: number;
	isRunning: boolean;
	isPaused: boolean;
	isDone: boolean;
	lastResult?: string;
	currentUrl?: string;
	totalInputTokens: number;
	totalOutputTokens: number;
	cumulativeCost: AccumulatedCost;
	currentPlan?: string;
	lastPlanStep?: number;
}

// ── History ──

export interface StepRecord {
	step: number;
	timestamp: number;
	browserState: ViewportHistory;
	agentOutput: AgentDecision;
	actionResults: CommandResult[];
	error?: string;
	usage?: InferenceUsage;
	duration: number;
	metadata?: StepTelemetry;
	detectedVariables?: ExtractedVariable[];
}

/**
 * Concrete class wrapping agent execution history with helper methods.
 *
 * Replaces the plain ExecutionLog interface so that consumers can call
 * convenience methods like `finalResult()`, `isDone()`, `urls()`, etc.
 */
export class ExecutionLog {
	readonly entries: StepRecord[];
	readonly task: string;
	readonly startTime: number;
	endTime?: number;
	totalDuration?: number;
	totalSteps: number;
	totalInputTokens: number;
	totalOutputTokens: number;

	constructor(init: {
		entries?: StepRecord[];
		task: string;
		startTime?: number;
	}) {
		this.entries = init.entries ?? [];
		this.task = init.task;
		this.startTime = init.startTime ?? Date.now();
		this.totalSteps = this.entries.length;
		this.totalInputTokens = 0;
		this.totalOutputTokens = 0;
		this.recomputeTotals();
	}

	/** Recalculate aggregate totals from entries. Called internally and from static factories. */
	recomputeTotals(): void {
		this.totalSteps = this.entries.length;
		this.totalInputTokens = 0;
		this.totalOutputTokens = 0;
		for (const entry of this.entries) {
			if (entry.usage) {
				this.totalInputTokens += entry.usage.inputTokens;
				this.totalOutputTokens += entry.usage.outputTokens;
			}
		}
	}

	/** Push a new entry and update totals. */
	addEntry(entry: StepRecord): void {
		this.entries.push(entry);
		this.recomputeTotals();
	}

	/** Mark the history as finished. */
	finish(): void {
		this.endTime = Date.now();
		this.totalDuration = this.endTime - this.startTime;
		this.recomputeTotals();
	}

	/**
	 * Returns the final result text from the last "done" action, or undefined
	 * if the agent never completed with a done action.
	 */
	finalResult(): string | undefined {
		for (let i = this.entries.length - 1; i >= 0; i--) {
			const entry = this.entries[i];
			for (const result of entry.actionResults) {
				if (result.isDone && result.extractedContent) {
					return result.extractedContent;
				}
			}
		}
		return undefined;
	}

	/**
	 * Whether the agent reached a "done" action at any point.
	 */
	isDone(): boolean {
		return this.entries.some((entry) =>
			entry.actionResults.some((r) => r.isDone),
		);
	}

	/**
	 * Deduplicated list of all URLs visited during execution (in order of first visit).
	 */
	urls(): string[] {
		const seen = new Set<string>();
		const result: string[] = [];
		for (const entry of this.entries) {
			const url = entry.browserState.url;
			if (url && !seen.has(url)) {
				seen.add(url);
				result.push(url);
			}
		}
		return result;
	}

	/**
	 * All screenshot base64 strings collected during execution (chronological).
	 */
	screenshots(): string[] {
		const result: string[] = [];
		for (const entry of this.entries) {
			if (entry.browserState.screenshot) {
				result.push(entry.browserState.screenshot);
			}
		}
		return result;
	}

	/**
	 * All errors encountered during execution.
	 */
	errors(): string[] {
		const result: string[] = [];
		for (const entry of this.entries) {
			if (entry.error) {
				result.push(entry.error);
			}
			for (const ar of entry.actionResults) {
				if (ar.error) {
					result.push(ar.error);
				}
			}
		}
		return result;
	}

	/**
	 * All detected variables across all steps.
	 */
	allExtractedVariables(): ExtractedVariable[] {
		const result: ExtractedVariable[] = [];
		for (const entry of this.entries) {
			if (entry.detectedVariables) {
				result.push(...entry.detectedVariables);
			}
		}
		return result;
	}

	/**
	 * Serialize the full history to a JSON-compatible object for saving to disk.
	 */
	toJSON(): Record<string, unknown> {
		return {
			task: this.task,
			startTime: this.startTime,
			endTime: this.endTime,
			totalDuration: this.totalDuration,
			totalSteps: this.totalSteps,
			totalInputTokens: this.totalInputTokens,
			totalOutputTokens: this.totalOutputTokens,
			entries: this.entries.map((e) => ({
				...e,
				// Strip screenshot data from serialized form to keep file size down
				browserState: {
					...e.browserState,
					screenshot: e.browserState.screenshot ? '[screenshot omitted]' : undefined,
				},
			})),
		};
	}

	/**
	 * Save the history to a file at the given path (JSON format).
	 * Returns the written path.
	 */
	async saveToFile(filePath: string): Promise<string> {
		const { writeFile, mkdir } = await import('node:fs/promises');
		const { dirname } = await import('node:path');
		await mkdir(dirname(filePath), { recursive: true });
		const json = JSON.stringify(this.toJSON(), null, 2);
		await writeFile(filePath, json, 'utf-8');
		return filePath;
	}

	/**
	 * Load history from a JSON file. Screenshots will be placeholders.
	 */
	static async loadFromFile(filePath: string): Promise<ExecutionLog> {
		const { readFile } = await import('node:fs/promises');
		const raw = await readFile(filePath, 'utf-8');
		const data = JSON.parse(raw) as Record<string, unknown>;
		const list = new ExecutionLog({
			task: (data.task as string) ?? '',
			startTime: (data.startTime as number) ?? Date.now(),
		});
		list.endTime = data.endTime as number | undefined;
		list.totalDuration = data.totalDuration as number | undefined;

		const entries = (data.entries ?? []) as StepRecord[];
		for (const entry of entries) {
			list.entries.push(entry);
		}
		list.recomputeTotals();
		return list;
	}
}

// ── Plan ──

export const PlanStepSchema = z.object({
	id: z.number(),
	description: z.string(),
	status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'blocked', 'skipped']),
	note: z.string().optional(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const StrategyPlanSchema = z.object({
	items: z.array(PlanStepSchema),
});

// ── Judgement ──

export const EvaluationResultSchema = z.object({
	isComplete: z.boolean(),
	reason: z.string(),
	confidence: z.number().min(0).max(1),
	verdict: z.string().optional().describe('Short human-readable verdict (e.g. "success", "partial", "failed")'),
	failureReason: z.string().optional().describe('Detailed reason if the task failed'),
	impossibleTask: z.boolean().optional().describe('Whether the task appears impossible to complete'),
	reachedCaptcha: z.boolean().optional().describe('Whether a CAPTCHA was encountered that blocked progress'),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

/**
 * Lightweight judgement result for simple pass/fail evaluation
 * without confidence scoring or detailed analysis.
 */
export const QuickCheckResultSchema = z.object({
	passed: z.boolean(),
	reason: z.string(),
	shouldRetry: z.boolean().optional().describe('Whether the agent should retry with a different approach'),
});

export type QuickCheckResult = z.infer<typeof QuickCheckResultSchema>;

// ── Cost Tracking ──

export interface StepCostBreakdown {
	inputCost: number;
	outputCost: number;
	totalCost: number;
}

export interface AccumulatedCost {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalInputCost: number;
	totalOutputCost: number;
	totalCost: number;
}

/** Per-model pricing in USD per 1M tokens */
export interface PricingTable {
	inputPer1M: number;
	outputPer1M: number;
}

export const PRICING_TABLE: Record<string, PricingTable> = {
	'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
	'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
	'gpt-4-turbo': { inputPer1M: 10, outputPer1M: 30 },
	'claude-3-opus': { inputPer1M: 15, outputPer1M: 75 },
	'claude-3-5-sonnet': { inputPer1M: 3, outputPer1M: 15 },
	'claude-3-5-haiku': { inputPer1M: 0.8, outputPer1M: 4 },
	'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
	'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
	'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5 },
	'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
};

export function calculateStepCost(
	inputTokens: number,
	outputTokens: number,
	modelId: string,
): StepCostBreakdown | undefined {
	let pricing: PricingTable | undefined;
	for (const [key, value] of Object.entries(PRICING_TABLE)) {
		if (modelId.startsWith(key)) {
			pricing = value;
			break;
		}
	}
	if (!pricing) return undefined;

	const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
	const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
	return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

// ── Plan Update ──

export const PlanRevisionSchema = z.object({
	plan: z.string().describe('Updated plan based on current progress'),
	reasoning: z.string().describe('Why the plan was updated'),
});

export type PlanRevision = z.infer<typeof PlanRevisionSchema>;

// ── Model capability helpers ──

const EXTENDED_THINKING_MODELS = [
	'claude-3-5-sonnet',
	'claude-3-opus',
	'claude-3-7-sonnet',
	'claude-4',
	'o1',
	'o1-pro',
	'o3',
	'o3-mini',
	'gemini-2.0-flash-thinking',
	'deepseek-r1',
];

export function supportsDeepReasoning(modelId: string): boolean {
	return EXTENDED_THINKING_MODELS.some((m) => modelId.includes(m));
}

const COORDINATE_CLICK_MODELS = [
	'gpt-4o',
	'claude-3-5-sonnet',
	'claude-4',
	'gemini-2.0',
	'gemini-1.5-pro',
];

export function supportsCoordinateMode(modelId: string): boolean {
	return COORDINATE_CLICK_MODELS.some((m) => modelId.includes(m));
}

const FLASH_MODELS = [
	'gpt-4o-mini',
	'claude-3-haiku',
	'claude-3-5-haiku',
	'gemini-1.5-flash',
	'gemini-2.0-flash',
];

export function isCompactModel(modelId: string): boolean {
	return FLASH_MODELS.some((m) => modelId.includes(m));
}

// ── Agent Run Result ──

export interface RunOutcome {
	finalResult?: string;
	success: boolean;
	history: ExecutionLog;
	errors: string[];
	detectedVariables?: ExtractedVariable[];
	judgement?: EvaluationResult;
	simpleJudgement?: QuickCheckResult;
	totalCost?: AccumulatedCost;
}
