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
