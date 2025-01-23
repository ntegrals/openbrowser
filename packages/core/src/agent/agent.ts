import { z, ZodError } from 'zod';
import type { LanguageModel, InferenceOptions } from '../model/interface.js';
import type { Viewport } from '../viewport/viewport.js';
import type { FileAccess } from '../sandbox/file-access.js';
import { PageAnalyzer } from '../page/page-analyzer.js';
import { CommandExecutor } from '../commands/executor.js';
import type { Command, CommandResult, ExecutionContext } from '../commands/types.js';
import { CommandSchema } from '../commands/types.js';
import { InstructionBuilder } from './instructions.js';
import { ConversationManager } from './conversation/service.js';
import { StallDetector, hashPageTree, hashTextContent } from './stall-detector.js';
import { ReplayRecorder } from './replay-recorder.js';
import { ResultEvaluator } from './evaluator.js';
import {
	type AgentConfig,
	type AgentState,
	type AgentDecision,
	type StepRecord,
	ExecutionLog,
	type RunOutcome,
	type AccumulatedCost,
	type EvaluationResult,
	type QuickCheckResult,
	ReasoningSchema,
	AgentDecisionCompactSchema,
	AgentDecisionDirectSchema,
	PlanRevisionSchema,
	DEFAULT_AGENT_CONFIG,
	calculateStepCost,
	supportsDeepReasoning,
	supportsCoordinateMode,
	isCompactModel,
} from './types.js';
import {
	AgentError,
	StepLimitExceededError,
	AgentStalledError,
	ModelThrottledError,
} from '../errors.js';
import {
	Timer,
	sleep,
	truncateText,
	withDeadline,
	extractUrls,
	escapeRegExp,
} from '../utils.js';
import { createLogger } from '../logging.js';

const logger = createLogger('agent');

// ── Agent Options ──

export interface AgentOptions {
	task: string;
	model: LanguageModel;
	browser: Viewport;
	tools?: CommandExecutor;
	/** Pre-configured PageAnalyzer instance (defaults to a new PageAnalyzer) */
	domService?: PageAnalyzer;
	settings?: Partial<AgentConfig>;
	/** Separate model for the judge (defaults to main model) */
	judgeModel?: LanguageModel;
	/** Separate model for extraction actions (defaults to main model) */
	extractionModel?: LanguageModel;
	/** File system access for sandbox operations */
	fileSystem?: FileAccess;
	onStepStart?: (step: number) => void;
	onStepEnd?: (step: number, result: CommandResult[]) => void;
	onDone?: (result: RunOutcome) => void;
}

// ── Agent ──

export class Agent {
	private model: LanguageModel;
	private browser: Viewport;
	private tools: CommandExecutor;
	private domService: PageAnalyzer;
	private messageManager: ConversationManager;
	private loopDetector: StallDetector;
	private gifRecorder?: ReplayRecorder;
	private judge?: ResultEvaluator;
	private settings: AgentConfig;
	private extractionModel?: LanguageModel;
	private fileSystem?: FileAccess;

	private state: AgentState;
	private historyList: ExecutionLog;
	private startTime = 0;
	private followUpTasks: string[] = [];

	private onStepStart?: (step: number) => void;
	private onStepEnd?: (step: number, result: CommandResult[]) => void;
	private onDone?: (result: RunOutcome) => void;

	constructor(options: AgentOptions) {
		this.model = options.model;
		this.browser = options.browser;
		this.settings = { ...DEFAULT_AGENT_CONFIG, ...options.settings, task: options.task };
		this.extractionModel = options.extractionModel;
		this.fileSystem = options.fileSystem;

		this.tools = options.tools ?? new CommandExecutor({
			model: this.extractionModel ?? this.model,
			allowedUrls: this.settings.allowedUrls,
			blockedUrls: this.settings.blockedUrls,
			commandsPerStep: this.settings.commandsPerStep,
		});

		this.domService = options.domService ?? new PageAnalyzer({
			capturedAttributes: this.settings.capturedAttributes,
		});

		this.messageManager = new ConversationManager({
			contextWindowSize: this.settings.contextWindowSize,
			includeLastScreenshot: this.settings.enableScreenshots,
			maskedValues: this.settings.maskedValues,
			compaction: this.settings.conversationCompaction,
		});

		this.loopDetector = new StallDetector();

		if (this.settings.replayOutputPath) {
			this.gifRecorder = new ReplayRecorder({
				outputPath: this.settings.replayOutputPath,
			});
		}

		// Judge setup
		if (this.settings.enableEvaluation || this.settings.enableSimpleJudge) {
			const judgeModel = options.judgeModel ?? this.model;
			this.judge = new ResultEvaluator(judgeModel);
		}

		// Auto-enable coordinate clicking for supported models
		if (this.settings.autoEnableCoordinateClicking) {
			if (supportsCoordinateMode(this.model.modelId)) {
				this.tools.setCoordinateClicking(true);
				logger.info(`Coordinate clicking auto-enabled for model ${this.model.modelId}`);
			}
		}

		// Initialize state
		this.state = {
			step: 0,
			stepLimit: this.settings.stepLimit,
			failureCount: 0,
			consecutiveFailures: 0,
			isRunning: false,
			isPaused: false,
			isDone: false,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			cumulativeCost: {
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalInputCost: 0,
				totalOutputCost: 0,
				totalCost: 0,
			},
		};

		this.historyList = new ExecutionLog({
			task: this.settings.task,
		});

		this.onStepStart = options.onStepStart;
		this.onStepEnd = options.onStepEnd;
		this.onDone = options.onDone;
	}

	// ────────────────────────────────────────
	//  Main run loop
	// ────────────────────────────────────────

	async run(stepLimit?: number): Promise<RunOutcome> {
		const effectiveMaxSteps = stepLimit ?? this.settings.stepLimit;
		this.state.stepLimit = effectiveMaxSteps;
		this.state.isRunning = true;
		this.startTime = Date.now();

		// Ensure browser is started
		if (!this.browser.isConnected) {
			await this.browser.start();
		}

		// Build system prompt (may be rebuilt per step if dynamicCommandSchema is on)
		this.rebuildInstructionBuilder();

		// URL extraction: auto-navigate to first URL found in task text
		if (this.settings.autoNavigateToUrls) {
			await this.autoNavigateFromTask();
		}

		// Execute initial actions before the main loop
		if (this.settings.preflightCommands.length > 0) {
			await this.executeInitialActions();
		}

		const errors: string[] = [];
		let finalResult: string | undefined;
		let success = false;
		let judgement: EvaluationResult | undefined;
		let simpleJudgement: QuickCheckResult | undefined;

		try {
			for (let step = 1; step <= effectiveMaxSteps; step++) {
				if (!this.state.isRunning || this.state.isDone) break;

				// Pause support
				while (this.state.isPaused) {
					await sleep(100);
				}

				this.state.step = step;
				this.onStepStart?.(step);

				try {
					// Wrap step execution in optional timeout
					const stepPromise = this.executeStep(step, effectiveMaxSteps);
					const result = this.settings.stepDeadlineMs > 0
						? await withDeadline(
								stepPromise,
								this.settings.stepDeadlineMs,
								`Step ${step} timed out after ${this.settings.stepDeadlineMs}ms`,
						  )
						: await stepPromise;

					this.state.consecutiveFailures = 0;

					// Check if done
					const doneResult = result.find((r) => r.isDone);
					if (doneResult) {
						finalResult = doneResult.extractedContent;
						success = doneResult.success;

						// Simple judge: quick validation before accepting the result
						if (this.settings.enableSimpleJudge && this.judge && finalResult) {
							simpleJudgement = await this.judge.simpleEvaluate(
								this.settings.task,
								finalResult,
							);

							if (simpleJudgement.shouldRetry && step < effectiveMaxSteps) {
								logger.info(
									`Simple judge suggests retry: ${simpleJudgement.reason}`,
								);
								this.messageManager.addCommandResultMessage(
									`The result was reviewed and found lacking: ${simpleJudgement.reason}. ` +
									'Please try a different approach to complete the task.',
									step,
								);
								// Don't mark as done -- continue the loop
								continue;
							}
						}

						this.state.isDone = true;
						break;
					}

					this.onStepEnd?.(step, result);

					// Planning: periodically update the plan
					if (this.settings.enableStrategy && this.shouldUpdatePlan(step)) {
						await this.updatePlan(step);
					}

					// Replan on stall: if loop detector shows stuck + planning enabled
					if (this.settings.restrategizeOnStall && this.settings.enableStrategy) {
						const loopCheck = this.loopDetector.isStuck();
						if (loopCheck.stuck && loopCheck.severity >= 2) {
							logger.info('Agent stalled, triggering replan');
							await this.updatePlan(step);
						}
					}

					// Message compaction: every N steps (LLM-based)
					if (this.messageManager.shouldCompactWithLlm()) {
						const compacted = await this.messageManager.compactWithLlm(this.model);
						if (compacted) {
							logger.debug(`Messages compacted at step ${step}`);
						}
					}

					// Save conversation per step if configured
					if (this.settings.conversationOutputPath) {
						await this.saveConversation(step);
					}
				} catch (error) {
					// Rate limit retry with exponential backoff
					if (error instanceof ModelThrottledError) {
						const waitMs = error.retryAfterMs ?? Math.min(
							60_000,
							this.settings.retryDelay * 1000 * 2 ** this.state.consecutiveFailures,
						);
						logger.warn(`Rate limited, waiting ${waitMs}ms before retry`);
						await sleep(waitMs);
						this.state.consecutiveFailures++;
						// Don't count rate limits toward max failures
						continue;
					}

					const message = error instanceof Error ? error.message : String(error);
					errors.push(`Step ${step}: ${message}`);

					this.state.failureCount++;
					this.state.consecutiveFailures++;

					if (this.state.consecutiveFailures >= this.settings.failureThreshold) {
						// Failure recovery: make one final LLM call to diagnose
						const failureSummary = await this.makeFailureRecoveryCall(errors);
						if (failureSummary) {
							finalResult = failureSummary;
						}

						throw new AgentError(
							`Too many consecutive failures (${this.state.consecutiveFailures})`,
						);
					}

					// Add error message to conversation
					this.messageManager.addCommandResultMessage(
						`Error: ${truncateText(message, 400)}`,
						step,
					);

					// Wait before retry
					await sleep(this.settings.retryDelay * 1000);
				}
			}

			if (!this.state.isDone && this.state.step >= effectiveMaxSteps) {
				throw new StepLimitExceededError(this.state.step, effectiveMaxSteps);
			}
		} catch (error) {
			if (
				error instanceof StepLimitExceededError ||
				error instanceof AgentStalledError ||
				error instanceof AgentError
			) {
				errors.push(error.message);
			} else {
				throw error;
			}
		} finally {
			this.state.isRunning = false;

			// Save recording
			if (this.gifRecorder) {
				await this.gifRecorder.save();
			}
		}

		// Full judge evaluation after completion
		if (this.settings.enableEvaluation && this.judge && finalResult) {
			judgement = await this.judge.evaluate(
				this.settings.task,
				finalResult,
				this.historyList.entries,
				{
					expectedOutcome: this.settings.expectedOutcome,
					includeScreenshots: this.settings.enableScreenshots,
				},
			);
		}

		// Finalize history
		this.historyList.finish();

		const runResult: RunOutcome = {
			finalResult,
			success,
			history: this.historyList,
			errors,
			judgement,
			simpleJudgement,
			totalCost: { ...this.state.cumulativeCost },
		};

		this.onDone?.(runResult);
		return runResult;
	}

	// ────────────────────────────────────────
	//  Step Execution
	// ────────────────────────────────────────

	private async executeStep(step: number, stepLimit: number): Promise<CommandResult[]> {
		const timer = new Timer();

		// Get browser state
		const browserState = await this.browser.getState();
		this.state.currentUrl = browserState.url;

		// Dynamic action schema: rebuild system prompt per step based on current URL
		if (this.settings.dynamicCommandSchema) {
			this.rebuildInstructionBuilder(browserState.url);
		}

		// Extract DOM
		const domState = await this.domService.extractState(
			this.browser.currentPage,
			this.browser.cdp!,
		);

		// Take screenshot if using vision
		let screenshot: string | undefined;
		if (this.settings.enableScreenshots) {
			const screenshotResult = await this.browser.screenshot();
			screenshot = screenshotResult.base64;

			if (this.gifRecorder) {
				const actionLabel = browserState.url;
				this.gifRecorder.addFrame(screenshot, step, actionLabel);
			}
		}

		// Build state message
		const stateText = InstructionBuilder.buildStatePrompt(
			browserState.url,
			browserState.title,
			browserState.tabs,
			domState.tree,
			step,
			stepLimit,
			domState.pixelsAbove,
			domState.pixelsBelow,
		);

		// Check for loop
		const loopCheck = this.loopDetector.isStuck();
		let additionalContext = '';
		if (loopCheck.stuck) {
			additionalContext = InstructionBuilder.buildLoopNudge(
				this.loopDetector.getLoopNudgeMessage(),
			);

			// Severe loop: throw stuck error
			if (loopCheck.severity >= 3) {
				throw new AgentStalledError(
					`Agent stuck: ${loopCheck.reason} (severity ${loopCheck.severity})`,
				);
			}
		}

		// Add plan context if planning is enabled
		if (this.settings.enableStrategy && this.state.currentPlan) {
			additionalContext += InstructionBuilder.buildPlanPrompt(this.state.currentPlan);
		}

		// Add messages
		this.messageManager.addStateMessage(
			stateText + additionalContext,
			screenshot,
			step,
		);

		// Determine output schema based on mode
		const outputSchema = this.getOutputSchema();

		// Invoke LLM with optional timeout and Zod recovery
		const completion = await this.invokeLlmWithRecovery(outputSchema, step);

		// Update token tracking
		this.state.totalInputTokens += completion.usage.inputTokens;
		this.state.totalOutputTokens += completion.usage.outputTokens;

		// Cost tracking
		this.updateCostTracking(completion.usage.inputTokens, completion.usage.outputTokens, step);

		const output = completion.parsed;

		// Normalize output to standard AgentDecision shape
		const normalizedOutput = this.normalizeOutput(output);

		// Add assistant response
		this.messageManager.addAssistantMessage(
			JSON.stringify(normalizedOutput.currentState),
			step,
		);

		// Execute actions
		const context: ExecutionContext = {
			page: this.browser.currentPage,
			cdpSession: this.browser.cdp!,
			domService: this.domService,
			browserSession: this.browser,
			extractionLlm: this.extractionModel,
			fileSystem: this.fileSystem,
			maskedValues: this.settings.maskedValues,
		};

		const actions = normalizedOutput.actions as Command[];
		const results = await this.tools.executeActions(actions, context);

		// Record for loop detection (with enhanced fingerprint)
		this.loopDetector.recordAction(actions);
		this.loopDetector.recordFingerprint({
			url: browserState.url,
			domHash: hashPageTree(domState.tree),
			scrollY: domState.scrollPosition.y,
			elementCount: domState.elementCount,
			textHash: hashTextContent(domState.tree.slice(0, 2000)),
		});

		// Filter sensitive data from results
		const filteredResults = this.filterSensitiveData(results);

		// Add action results to conversation
		const resultText = filteredResults
			.map((r, i) => {
				const actionName = actions[i]?.action ?? 'unknown';
				const status = r.success ? 'success' : `error: ${r.error}`;
				const content = r.extractedContent
					? `\nContent: ${r.extractedContent}`
					: '';
				return `${actionName}: ${status}${content}`;
			})
			.join('\n');

		if (resultText) {
			this.messageManager.addCommandResultMessage(resultText, step);
		}

		// Wait between actions
		if (this.settings.commandDelayMs > 0) {
			await sleep(this.settings.commandDelayMs * 1000);
		}

		// Record history entry
		const entry: StepRecord = {
			step,
			timestamp: Date.now(),
			browserState: {
				url: browserState.url,
				title: browserState.title,
				tabs: browserState.tabs,
				interactedElements: actions
					.filter((a): a is Command & { index: number } => 'index' in a)
					.map((a) => ({
						index: a.index,
						description: '',
						action: a.action,
					})),
				screenshot,
			},
			agentOutput: normalizedOutput as AgentDecision,
			actionResults: filteredResults,
			usage: completion.usage,
			duration: timer.elapsed(),
			metadata: {
				stepNumber: step,
				durationMs: timer.elapsed(),
				inputTokens: completion.usage.inputTokens,
				outputTokens: completion.usage.outputTokens,
				actionCount: actions.length,
				url: browserState.url,
				startedAt: Date.now() - timer.elapsed(),
				completedAt: Date.now(),
			},
		};

		this.historyList.addEntry(entry);

		return results;
	}

	// ────────────────────────────────────────
	//  LLM Invocation with Zod Recovery
	// ────────────────────────────────────────

	private async invokeLlmWithRecovery(
		outputSchema: z.ZodType<unknown>,
		step: number,
		retryCount = 0,
	): Promise<{
		parsed: Record<string, unknown>;
		usage: { inputTokens: number; outputTokens: number; totalTokens: number };
	}> {
		const messages = this.messageManager.getMessages();

		const invokeOptions: InferenceOptions<unknown> = {
			messages,
			responseSchema: outputSchema,
			schemaName: this.getSchemaName(),
			schemaDescription: 'Agent decision with current state assessment and actions to take',
		};

		// Extended thinking: pass thinking budget as maxTokens
		if (
			this.settings.enableDeepReasoning &&
			supportsDeepReasoning(this.model.modelId)
		) {
			invokeOptions.maxTokens = this.settings.reasoningBudget;
		}

		try {
			// Wrap LLM call in optional timeout
			const invokePromise = this.model.invoke(invokeOptions);
			const completion =
				this.settings.modelDeadlineMs > 0
					? await withDeadline(
							invokePromise,
							this.settings.modelDeadlineMs,
							`LLM call timed out after ${this.settings.modelDeadlineMs}ms`,
					  )
					: await invokePromise;

			return {
				parsed: completion.parsed as Record<string, unknown>,
				usage: completion.usage,
			};
		} catch (error) {
			// Zod validation error recovery: re-prompt with the error details
			if (error instanceof ZodError && retryCount < 2) {
				logger.warn(
					`Zod validation failed (attempt ${retryCount + 1}), re-prompting LLM`,
				);

				const issues = error.issues
					.map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
					.join('\n');

				this.messageManager.addCommandResultMessage(
					'Your previous response had a validation error. ' +
					'Please fix the following issues and respond again:\n' +
					`${issues}\n\n` +
					'Make sure your response matches the expected JSON schema exactly.',
					step,
				);

				return this.invokeLlmWithRecovery(outputSchema, step, retryCount + 1);
			}

			// Re-throw rate limit errors for special handling in the main loop
			if (error instanceof ModelThrottledError) {
				throw error;
			}

			throw error;
		}
	}

	// ────────────────────────────────────────
	//  Output Schema Selection
	// ────────────────────────────────────────

	private getOutputSchema(): z.ZodType<unknown> {
		// Flash mode: simpler schema for cheaper / faster models
		if (this.settings.compactMode || isCompactModel(this.model.modelId)) {
			return AgentDecisionCompactSchema as z.ZodType<unknown>;
		}

		// Extended thinking: model reasons internally, skip brain schema
		if (
			this.settings.enableDeepReasoning &&
			supportsDeepReasoning(this.model.modelId)
		) {
			return AgentDecisionDirectSchema as z.ZodType<unknown>;
		}

		// Default full schema with brain + typed action union
		return z.object({
			currentState: ReasoningSchema,
			actions: z.array(CommandSchema),
		}) as z.ZodType<unknown>;
	}

	private getSchemaName(): string {
		if (this.settings.compactMode || isCompactModel(this.model.modelId)) {
			return 'AgentDecisionCompact';
		}
		if (
			this.settings.enableDeepReasoning &&
			supportsDeepReasoning(this.model.modelId)
		) {
			return 'AgentDecisionDirect';
		}
		return 'AgentDecision';
	}

	/**
	 * Normalize the various output schema shapes into the standard AgentDecision.
	 */
	private normalizeOutput(output: Record<string, unknown>): AgentDecision {
		// Flash schema: { goal, actions }
		if ('goal' in output && !('currentState' in output)) {
			return {
				currentState: {
					evaluation: String(output.goal ?? ''),
					memory: '',
					nextGoal: String(output.goal ?? ''),
				},
				actions: (output.actions ?? []) as Record<string, unknown>[],
			};
		}

		// No-thinking schema: { actions } only
		if (!('currentState' in output) && 'actions' in output) {
			return {
				currentState: {
					evaluation: '',
					memory: '',
					nextGoal: '',
				},
				actions: (output.actions ?? []) as Record<string, unknown>[],
			};
		}

		// Standard schema passthrough
		return output as AgentDecision;
	}

	// ────────────────────────────────────────
	//  Planning System
	// ────────────────────────────────────────

	private shouldUpdatePlan(step: number): boolean {
		if (!this.settings.enableStrategy) return false;
		const interval =
			this.settings.strategyInterval > 0 ? this.settings.strategyInterval : 5;
		const lastPlan = this.state.lastPlanStep ?? 0;
		return step - lastPlan >= interval;
	}

	private async updatePlan(step: number): Promise<void> {
		try {
			const recentHistory = this.historyList.entries
				.slice(-5)
				.map(
					(e) =>
						`Step ${e.step}: ${e.agentOutput.currentState?.evaluation ?? '(no eval)'}`,
				)
				.join('\n');

			const planPrompt =
				`Task: ${this.settings.task}\n\n` +
				`Current step: ${step}/${this.state.stepLimit}\n` +
				(this.state.currentPlan
					? `Current plan:\n${this.state.currentPlan}\n\n`
					: '') +
				`Recent progress:\n${recentHistory}\n\n` +
				'Based on the current progress, provide an updated plan. ' +
				'Include what has been accomplished and what remains.';

			// Use ephemeral message so the plan prompt doesn't persist
			this.messageManager.addEphemeralMessage(planPrompt);

			const completion = await this.model.invoke({
				messages: this.messageManager.getMessages(),
				responseSchema: PlanRevisionSchema,
				schemaName: 'PlanRevision',
				temperature: 0.3,
			});

			this.state.currentPlan = completion.parsed.plan;
			this.state.lastPlanStep = step;

			logger.info(`Plan updated at step ${step}: ${completion.parsed.reasoning}`);
		} catch (error) {
			logger.warn(
				`Plan update failed at step ${step}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	// ────────────────────────────────────────
	//  System Prompt Management
	// ────────────────────────────────────────

	/**
	 * (Re)build the system prompt. When `pageUrl` is provided, the registry
	 * can filter action descriptions to show only domain-relevant actions.
	 */
	private rebuildInstructionBuilder(pageUrl?: string): void {
		const systemPrompt = InstructionBuilder.fromSettings(
			this.settings,
			this.tools.registry,
			pageUrl,
		);
		this.messageManager.setInstructionBuilder(systemPrompt.build());
	}

	// ────────────────────────────────────────
	//  URL Extraction from Task Text
	// ────────────────────────────────────────

	private async autoNavigateFromTask(): Promise<void> {
		const urls = extractUrls(this.settings.task);
		if (urls.length === 0) return;

		const firstUrl = urls[0];
		logger.info(`Auto-navigating to URL found in task: ${firstUrl}`);

		try {
			await this.browser.navigate(firstUrl);
			// Give the page a moment to load
			await sleep(1000);
		} catch (error) {
			logger.warn(
				`Auto-navigation to ${firstUrl} failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	// ────────────────────────────────────────
	//  Initial Actions
	// ────────────────────────────────────────

	private async executeInitialActions(): Promise<void> {
		logger.info(
			`Executing ${this.settings.preflightCommands.length} initial action(s)`,
		);

		const context: ExecutionContext = {
			page: this.browser.currentPage,
			cdpSession: this.browser.cdp!,
			domService: this.domService,
			browserSession: this.browser,
			extractionLlm: this.extractionModel,
			fileSystem: this.fileSystem,
			maskedValues: this.settings.maskedValues,
		};

		for (const action of this.settings.preflightCommands) {
			try {
				await this.tools.executeAction(action, context);
				logger.debug(`Initial action ${action.action} completed`);
			} catch (error) {
				logger.warn(
					`Initial action ${action.action} failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		await sleep(500);
	}

	// ────────────────────────────────────────
	//  Failure Recovery
	// ────────────────────────────────────────

	/**
	 * On max failures, make one final LLM call to produce a diagnostic
	 * summary. Returns a description of what went wrong, or undefined
	 * if the recovery call itself fails.
	 */
	private async makeFailureRecoveryCall(
		errors: string[],
	): Promise<string | undefined> {
		try {
			const errorSummary = errors.slice(-5).join('\n');

			const recoverySchema = z.object({
				diagnosis: z.string().describe('What went wrong'),
				suggestion: z.string().describe('What could be tried differently'),
			});

			const completion = await this.model.invoke({
				messages: [
					{
						role: 'system' as const,
						content:
							'You are a diagnostic assistant. Analyze the errors that occurred during ' +
							'a web browsing automation task and provide a brief diagnosis.',
					},
					{
						role: 'user' as const,
						content:
							`Task: ${this.settings.task}\n\n` +
							`Errors encountered:\n${errorSummary}\n\n` +
							'Provide a brief diagnosis of what went wrong and what could be tried differently.',
					},
				],
				responseSchema: recoverySchema,
				schemaName: 'FailureRecovery',
				temperature: 0,
			});

			const result =
				`Task failed. Diagnosis: ${completion.parsed.diagnosis}. ` +
				`Suggestion: ${completion.parsed.suggestion}`;
			logger.info(`Failure recovery: ${result}`);
			return result;
		} catch {
			logger.debug('Failure recovery call itself failed');
			return undefined;
		}
	}

	// ────────────────────────────────────────
	//  Cost Tracking
	// ────────────────────────────────────────

	private updateCostTracking(
		inputTokens: number,
		outputTokens: number,
		step: number,
	): void {
		const stepCost = calculateStepCost(
			inputTokens,
			outputTokens,
			this.model.modelId,
		);

		this.state.cumulativeCost.totalInputTokens += inputTokens;
		this.state.cumulativeCost.totalOutputTokens += outputTokens;

		if (stepCost) {
			this.state.cumulativeCost.totalInputCost += stepCost.inputCost;
			this.state.cumulativeCost.totalOutputCost += stepCost.outputCost;
			this.state.cumulativeCost.totalCost += stepCost.totalCost;

			logger.debug(
				`Step ${step} cost: $${stepCost.totalCost.toFixed(4)} ` +
				`(cumulative: $${this.state.cumulativeCost.totalCost.toFixed(4)})`,
			);
		}
	}

	// ────────────────────────────────────────
	//  Sensitive Data Filtering
	// ────────────────────────────────────────

	private filterSensitiveData(results: CommandResult[]): CommandResult[] {
		if (!this.settings.maskedValues) return results;

		return results.map((r) => {
			if (!r.extractedContent) return r;

			let content = r.extractedContent;
			for (const [key, value] of Object.entries(this.settings.maskedValues!)) {
				content = content.replace(
					new RegExp(escapeRegExp(value), 'g'),
					`<${key}>`,
				);
			}

			return { ...r, extractedContent: content };
		});
	}

	// ────────────────────────────────────────
	//  Save Conversation
	// ────────────────────────────────────────

	private async saveConversation(step: number): Promise<void> {
		if (!this.settings.conversationOutputPath) return;

		try {
			const filePath = this.settings.conversationOutputPath.replace(
				/\{step\}/g,
				step.toString(),
			);
			await this.messageManager.saveToFile(filePath);
		} catch (error) {
			logger.debug(
				`Failed to save conversation at step ${step}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	// ────────────────────────────────────────
	//  Follow-up Tasks
	// ────────────────────────────────────────
