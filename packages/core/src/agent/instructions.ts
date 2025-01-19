import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentConfig } from './types.js';
import type { ViewportSnapshot, TabDescriptor } from '../viewport/types.js';
import type { CommandCatalog } from '../commands/catalog/catalog.js';
import type { ContentPart } from '../model/messages.js';
import { textContent, imageContent } from '../model/messages.js';
import { isNewTabPage, sanitizeSurrogates, dedent } from '../utils.js';

// ── Template types ──

export type PromptTemplate = 'default' | 'flash' | 'no-thinking';

export interface InstructionBuilderOptions {
	/** Maximum actions the agent can take per step. */
	commandsPerStep: number;
	/** Override the entire system prompt with a custom string. */
	overrideInstructionBuilder?: string;
	/** Append additional instructions to the system prompt. */
	extendInstructionBuilder?: string;
	/** Which template variant to use. Defaults to 'default'. */
	template?: PromptTemplate;
	/** Whether to include sensitive-data warnings. */
	hasSensitiveData?: boolean;
}

export interface StepInfo {
	step: number;
	stepLimit: number;
}

export interface StepPromptBuilderOptions {
	browserState: ViewportSnapshot;
	task: string;
	stepInfo?: StepInfo;
	actionDescriptions?: string;
	pageFilteredActions?: string;
	agentHistoryDescription?: string;
	maskedValues?: string;
	planDescription?: string;
	screenshots?: string[];
	enableScreenshots?: boolean;
	maxElementsLength?: number;
}

// ── Template loading ──

/**
 * Directory containing the .md system prompt templates.
 * Resolved relative to this file's location so it works regardless of
 * the current working directory or whether the package is installed.
 */
const TEMPLATES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'instructions');

/** Cache loaded templates so we only hit the filesystem once per variant. */
const templateCache = new Map<string, string>();

/**
 * Map from PromptTemplate variant to the corresponding filename.
 */
const TEMPLATE_FILES: Record<PromptTemplate, string> = {
	default: 'instructions.md',
	flash: 'instructions-compact.md',
	'no-thinking': 'instructions-direct.md',
};

/**
 * Load a system-prompt template from disk. Results are cached.
