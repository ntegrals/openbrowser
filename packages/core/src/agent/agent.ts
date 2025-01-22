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
