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
