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
 *
 * @param variant - Which prompt template to load.
 * @returns The raw template string with `{{variable}}` placeholders.
 * @throws If the template file cannot be read.
 */
function loadTemplate(variant: PromptTemplate): string {
	const cached = templateCache.get(variant);
	if (cached !== undefined) return cached;

	const filename = TEMPLATE_FILES[variant];
	const filepath = resolve(TEMPLATES_DIR, filename);

	try {
		const content = readFileSync(filepath, 'utf-8');
		templateCache.set(variant, content);
		return content;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to load system prompt template "${filename}": ${message}`);
	}
}

/**
 * Interpolate `{{key}}` placeholders in a template string.
 * Unmatched placeholders are left as-is so downstream code can detect them.
 */
function interpolate(template: string, variables: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
		return key in variables ? variables[key] : match;
	});
}

/**
 * Clear the template cache. Useful for testing or hot-reloading.
 */
export function clearTemplateCache(): void {
	templateCache.clear();
}

// ── InstructionBuilder ──

/**
 * Builds the system prompt for the browser automation agent.
 *
 * In the simplest case it loads a `.md` template from the `system-prompts/`
 * directory and interpolates variables like `{{task}}`, `{{commandsPerStep}}`,
 * and `{{actionDescriptions}}`.
 *
 * The class also exposes static helpers for building per-step state messages,
 * action results, and other ancillary prompt fragments that are injected as
 * user messages during the agent loop.
 */
export class InstructionBuilder {
	private options: InstructionBuilderOptions;
	private actionDescriptions: string;

	constructor(options: InstructionBuilderOptions, actionDescriptions: string) {
		this.options = options;
		this.actionDescriptions = actionDescriptions;
	}

	/**
	 * Build and return the complete system prompt string.
	 *
	 * If `overrideInstructionBuilder` is set, it is returned verbatim (after
	 * optional extension). Otherwise, the appropriate `.md` template is
	 * loaded and interpolated with the current settings.
	 */
	build(): string {
		if (this.options.overrideInstructionBuilder) {
			let prompt = this.options.overrideInstructionBuilder;
			if (this.options.extendInstructionBuilder) {
				prompt += `\n${this.options.extendInstructionBuilder}`;
			}
			return prompt;
		}

		const variant = this.options.template ?? 'default';
		const template = loadTemplate(variant);

		const variables: Record<string, string> = {
			task: '(set per-step in user messages)',
			commandsPerStep: String(this.options.commandsPerStep),
			actionDescriptions: this.actionDescriptions,
		};

		let prompt = interpolate(template, variables);

		if (this.options.extendInstructionBuilder) {
			prompt += `\n${this.options.extendInstructionBuilder}`;
		}

		return prompt;
	}

	/**
	 * Convenience: create a InstructionBuilder from AgentConfig + a CommandCatalog.
	 * Pulls action descriptions directly from the registry, optionally
	 * filtered by the current page URL.
	 */
	static fromSettings(settings: AgentConfig, registry: CommandCatalog, pageUrl?: string): InstructionBuilder {
		const descriptions = registry.getPromptDescription(pageUrl);

		return new InstructionBuilder(
			{
