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
