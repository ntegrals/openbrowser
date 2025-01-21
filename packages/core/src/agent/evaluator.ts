import type { LanguageModel } from '../model/interface.js';
import type { Message, ContentPart } from '../model/messages.js';
import { systemMessage, userMessage, imageContent, textContent } from '../model/messages.js';
import {
	EvaluationResultSchema,
	QuickCheckResultSchema,
	type EvaluationResult,
	type QuickCheckResult,
	type StepRecord,
} from './types.js';
import { createLogger } from '../logging.js';

const logger = createLogger('judge');

// ── Judge System Prompts ──

const JUDGE_SYSTEM_PROMPT = `You are an expert task completion judge. Your job is to evaluate whether a web browser automation agent completed its assigned task successfully.

You will be provided with:
1. The task description
2. A history of steps the agent took (including actions and their results)
3. Screenshots from during execution (if available)
4. Optionally, ground truth information about the expected result

Evaluate thoroughly:
- Did the agent actually complete the task, or just claim to?
- Is the extracted information correct and complete?
- Did the agent handle errors and edge cases appropriately?
- Was the agent stuck at any point without recovery?

If ground truth is provided, compare the agent's result against it.

Be strict but fair. Partial completions should be marked with lower confidence.`;

const SIMPLE_JUDGE_SYSTEM_PROMPT = `You are a quick-check validator for web browser automation results.
Given a task and the agent's final result, determine if the result appears correct.
Be concise. Focus on whether the result directly answers/completes the task.`;

export class ResultEvaluator {
	private model: LanguageModel;

	constructor(model: LanguageModel) {
		this.model = model;
	}

	/**
	 * Full evaluation with step history, screenshots, and optional ground truth.
	 * Provides detailed verdict with failure analysis.
	 */
	async evaluate(
		task: string,
		result: string,
		history: StepRecord[],
		options?: {
			expectedOutcome?: string;
			includeScreenshots?: boolean;
		},
	): Promise<EvaluationResult> {
		const messages = constructEvaluatorMessages(task, result, history, options);

		try {
			const completion = await this.model.invoke({
				messages,
				responseSchema: EvaluationResultSchema,
				schemaName: 'EvaluationResult',
				temperature: 0,
			});

			logger.info(
				`Judge verdict: complete=${completion.parsed.isComplete}, ` +
				`confidence=${completion.parsed.confidence}, ` +
				`verdict=${completion.parsed.verdict ?? 'n/a'}`,
			);

			return completion.parsed;
		} catch (error) {
			logger.error('Judge evaluation failed', error);
			return {
				isComplete: false,
				reason: `Judge evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
				confidence: 0,
				verdict: 'unknown',
			};
		}
	}

	/**
	 * Lightweight always-on validation.
	 * Quick pass/fail check without detailed history analysis.
	 * Useful for running after every "done" action to catch obvious errors.
	 */
	async simpleEvaluate(
		task: string,
		result: string,
	): Promise<QuickCheckResult> {
		const messages = constructQuickCheckMessages(task, result);

		try {
			const completion = await this.model.invoke({
				messages,
				responseSchema: QuickCheckResultSchema,
				schemaName: 'QuickCheckResult',
				temperature: 0,
			});

			logger.debug(
				`Simple judge: passed=${completion.parsed.passed}, reason=${completion.parsed.reason}`,
			);

			return completion.parsed;
		} catch (error) {
			logger.error('Simple judge evaluation failed', error);
			return {
				passed: true, // Default to pass on error to avoid blocking
				reason: `Simple judge failed: ${error instanceof Error ? error.message : String(error)}`,
				shouldRetry: false,
			};
		}
	}
}

// ── Message Construction ──

/**
 * Build the full message array for detailed judge evaluation.
 * Includes step-by-step history, screenshots (if enabled), and ground truth.
 */
export function constructEvaluatorMessages(
	task: string,
	result: string,
	history: StepRecord[],
	options?: {
		expectedOutcome?: string;
		includeScreenshots?: boolean;
	},
): Message[] {
	const messages: Message[] = [
		systemMessage(JUDGE_SYSTEM_PROMPT),
	];

	// Build the evaluation prompt
	const parts: string[] = [];
	parts.push(`## Task\n${task}`);
	parts.push(`## Agent's Final Result\n${result}`);

	// Step history summary
	if (history.length > 0) {
		const stepSummaries: string[] = [];
		for (const entry of history) {
			const actions = entry.agentOutput.actions
				.map((a) => {
					const actionObj = a as Record<string, unknown>;
					return actionObj.action ?? 'unknown';
				})
				.join(', ');

			const results = entry.actionResults
				.map((r) => {
					if (r.isDone) return `DONE: ${r.extractedContent?.slice(0, 200) ?? ''}`;
					if (r.error) return `ERROR: ${r.error.slice(0, 150)}`;
