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
