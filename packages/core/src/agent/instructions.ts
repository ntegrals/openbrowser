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
				commandsPerStep: settings.commandsPerStep,
				overrideInstructionBuilder: settings.overrideInstructionBuilder,
				extendInstructionBuilder: settings.extendInstructionBuilder,
				hasSensitiveData: settings.maskedValues !== undefined,
			},
			descriptions,
		);
	}

	// ── Static prompt fragment builders ──

	static buildTaskPrompt(task: string): string {
		return `Your current task: ${task}`;
	}

	static buildStatePrompt(
		url: string,
		title: string,
		tabs: Array<{ url: string; title: string; isActive: boolean }>,
		domTree: string,
		step: number,
		stepLimit: number,
		pixelsAbove?: number,
		pixelsBelow?: number,
	): string {
		const parts: string[] = [];

		parts.push(`[Step ${step}/${stepLimit}]`);
		parts.push(`Current URL: ${url}`);
		parts.push(`Page Title: ${title}`);

		if (tabs.length > 1) {
			const tabList = tabs
				.map((t, i) => `  [${i}] ${t.isActive ? '(active) ' : ''}${t.title} - ${t.url}`)
				.join('\n');
			parts.push(`Open Tabs:\n${tabList}`);
		}

		if (pixelsAbove !== undefined && pixelsAbove > 0) {
			parts.push(`Scroll position: ${pixelsAbove}px from top`);
		}
		if (pixelsBelow !== undefined && pixelsBelow > 0) {
			parts.push(`${pixelsBelow}px of content below the visible area`);
		}

		parts.push(`\nPage content:\n${domTree}`);

		return parts.join('\n');
	}

	static buildCommandResultPrompt(results: Array<{ action: string; result: string }>): string {
		if (results.length === 0) return '';

		const formatted = results
			.map((r) => `Action: ${r.action}\nResult: ${r.result}`)
			.join('\n---\n');

		return `Previous action results:\n${formatted}`;
	}

	static buildLoopNudge(message: string): string {
		return `\nIMPORTANT: ${message}`;
	}

	static buildPlanPrompt(currentPlan: string): string {
		return `\nCurrent plan:\n${currentPlan}`;
	}
}

// ── StepPromptBuilder ──

/**
 * Constructs the per-step user message for the agent.
 *
 * Each step of the agent loop sends a user message containing:
 * - The current browser state (URL, tabs, interactive elements)
 * - Scroll position and page boundaries
 * - Agent history summary
 * - Step information (step N of M)
 * - Optionally: screenshots, sensitive data warnings, plan description
 * - Optionally: page-specific action descriptions
 *
 * The message can be returned as a plain string or as a multipart content
 * array (text + images) when vision is enabled.
 */
export class StepPromptBuilder {
	private browserState: ViewportSnapshot;
	private task: string;
	private stepInfo?: StepInfo;
	private actionDescriptions?: string;
	private pageFilteredActions?: string;
	private agentHistoryDescription?: string;
	private maskedValues?: string;
	private planDescription?: string;
	private screenshots: string[];
	private enableScreenshots: boolean;
	private maxElementsLength: number;

	constructor(options: StepPromptBuilderOptions) {
		this.browserState = options.browserState;
		this.task = options.task;
		this.stepInfo = options.stepInfo;
		this.actionDescriptions = options.actionDescriptions;
		this.pageFilteredActions = options.pageFilteredActions;
		this.agentHistoryDescription = options.agentHistoryDescription;
		this.maskedValues = options.maskedValues;
		this.planDescription = options.planDescription;
		this.screenshots = options.screenshots ?? [];
		this.enableScreenshots = options.enableScreenshots ?? false;
		this.maxElementsLength = options.maxElementsLength ?? 40_000;
	}

	/**
	 * Build the user message content.
	 *
	 * When vision is disabled (or no screenshots are available), returns a
	 * single string. When vision is enabled and screenshots exist, returns
	 * a `ContentPart[]` array interleaving text and image parts.
	 */
	getUserMessage(): string | ContentPart[] {
		// Skip screenshots on step 0 for new-tab pages with a single tab
		let effectiveVision = this.enableScreenshots;
		if (
			isNewTabPage(this.browserState.url) &&
			this.stepInfo?.step === 0 &&
			this.browserState.tabs.length <= 1
		) {
			effectiveVision = false;
		}

		const stateDescription = this.buildStateDescription();

		if (effectiveVision && this.screenshots.length > 0) {
			const parts: ContentPart[] = [textContent(stateDescription)];

			for (let i = 0; i < this.screenshots.length; i++) {
				const label =
					i === this.screenshots.length - 1 ? 'Current screenshot:' : 'Previous screenshot:';
				parts.push(textContent(label));
				parts.push(imageContent(this.screenshots[i], 'image/png'));
			}

			return parts;
		}

		return stateDescription;
	}

	/**
	 * Build the complete text description of the current state.
	 * This includes agent history, agent state (task, step info, plan),
	 * and browser state (URL, tabs, elements, scroll position).
	 */
	private buildStateDescription(): string {
		const sections: string[] = [];

		// Agent history
		sections.push(this.buildAgentHistorySection());

		// Agent state (task, step info, plan, sensitive data)
		sections.push(this.buildAgentStateSection());

		// Browser state (URL, tabs, elements)
		sections.push(this.buildBrowserStateSection());

		// Page-specific actions (if any domain-filtered actions apply)
		if (this.pageFilteredActions) {
			sections.push(
				`<page_specific_actions>\n${this.pageFilteredActions}\n</page_specific_actions>`,
			);
		}

		// Sanitize surrogates to prevent JSON serialization issues
		return sanitizeSurrogates(sections.join('\n\n'));
	}

	private buildAgentHistorySection(): string {
		const history = this.agentHistoryDescription?.trim() ?? '';
		return `<agent_history>\n${history}\n</agent_history>`;
	}

	private buildAgentStateSection(): string {
		const parts: string[] = [];

		parts.push(`<user_request>\n${this.task}\n</user_request>`);

		if (this.planDescription) {
			parts.push(`<plan>\n${this.planDescription}\n</plan>`);
		}

		if (this.maskedValues) {
			parts.push(`<sensitive_data>${this.maskedValues}</sensitive_data>`);
		}

		if (this.stepInfo) {
			const today = new Date().toISOString().slice(0, 10);
			parts.push(
				`<step_info>Step ${this.stepInfo.step + 1} of ${this.stepInfo.stepLimit} | Today: ${today}</step_info>`,
			);
		}

		return `<agent_state>\n${parts.join('\n')}\n</agent_state>`;
	}

	private buildBrowserStateSection(): string {
		const parts: string[] = [];

		// Tabs
		const tabsText = this.buildTabsText();
		if (tabsText) {
			parts.push(tabsText);
		}

		// Scroll / page info
		const pageInfo = this.buildPageInfoText();
		if (pageInfo) {
			parts.push(pageInfo);
		}

		// Interactive elements
		parts.push(this.buildElementsText());

		return `<browser_state>\n${parts.join('\n')}\n</browser_state>`;
	}

	private buildTabsText(): string {
		const { tabs, url, title } = this.browserState;
		if (tabs.length === 0) return '';

		// Try to identify the current tab
		const currentCandidates = tabs.filter((t) => t.url === url && t.title === title);
		const currentTabId =
			currentCandidates.length === 1 ? currentCandidates[0].tabId : undefined;

		const lines: string[] = [];
		if (currentTabId) {
			lines.push(`Current tab: ${String(currentTabId).slice(-4)}`);
		}

		lines.push('Available tabs:');
		for (const tab of tabs) {
			lines.push(`Tab ${String(tab.tabId).slice(-4)}: ${tab.url} - ${tab.title.slice(0, 30)}`);
		}

		return lines.join('\n');
	}

	private buildPageInfoText(): string {
		const { pixelsAbove, pixelsBelow } = this.browserState;
		const parts: string[] = [];

		if (pixelsAbove !== undefined && pixelsAbove > 0) {
			// Estimate "pages above" assuming ~900px viewport height
			const pagesAbove = (pixelsAbove / 900).toFixed(1);
			parts.push(`${pagesAbove} pages above`);
		}
		if (pixelsBelow !== undefined && pixelsBelow > 0) {
			const pagesBelow = (pixelsBelow / 900).toFixed(1);
			parts.push(`${pagesBelow} pages below`);
		}

		if (parts.length === 0) return '';
		return `<page_info>${parts.join(', ')}</page_info>`;
	}

	private buildElementsText(): string {
		let elementsText = this.browserState.domTree ?? '';

		if (!elementsText) {
			return 'Interactive elements:\nempty page';
		}

		// Truncate if too long
		let truncatedNote = '';
		if (elementsText.length > this.maxElementsLength) {
			elementsText = elementsText.slice(0, this.maxElementsLength);
			truncatedNote = ` (truncated to ${this.maxElementsLength} characters)`;
		}

		// Add start/end of page markers based on scroll position
		const hasContentAbove =
			this.browserState.pixelsAbove !== undefined && this.browserState.pixelsAbove > 0;
		const hasContentBelow =
			this.browserState.pixelsBelow !== undefined && this.browserState.pixelsBelow > 0;

		if (!hasContentAbove) {
			elementsText = `[Start of page]\n${elementsText}`;
		}
		if (!hasContentBelow) {
			elementsText = `${elementsText}\n[End of page]`;
		}

		return `Interactive elements${truncatedNote}:\n${elementsText}`;
	}
}

// ── Dynamic action descriptions ──

/**
 * Build action descriptions from a registry, optionally filtered by
 * the current page URL. Returns a formatted string suitable for
 * injection into the system prompt's `{{actionDescriptions}}` slot.
 */
export function buildCommandDescriptions(registry: CommandCatalog, pageUrl?: string): string {
	return registry.getPromptDescription(pageUrl);
}

/**
 * Build a description of actions that are specific to the current page's domain.
 * Returns `undefined` if there are no domain-specific actions beyond the
 * universal set.
 *
 * This is injected as a `<page_specific_actions>` section in the per-step
 * user message when the page URL triggers extra actions.
 */
export function buildContextualCommands(registry: CommandCatalog, pageUrl: string): string | undefined {
	const allActions = registry.getAll();
	const domainActions = registry.getActionsForDomain(extractDomain(pageUrl));

	// If all actions are already shown (no domain filtering), nothing extra to show
	if (domainActions.length === allActions.length) return undefined;

	// Find domain-specific actions (ones that have a domainFilter)
	const extraActions = domainActions.filter(
		(a) => a.domainFilter && a.domainFilter.length > 0,
	);

	if (extraActions.length === 0) return undefined;

	const lines = extraActions.map(
		(a) => `- ${a.name}: ${a.description}`,
	);

	return `The following actions are available on this page:\n${lines.join('\n')}`;
}

// ── Rerun / extraction prompt helpers ──

/**
 * Build a system prompt for the extraction/AI-step action used during reruns.
 */
export function buildExtractionInstructionBuilder(): string {
	return dedent(`
		You are an expert at extracting data from webpages.

		You will be given:
		1. A query describing what to extract
		2. The markdown of the webpage (filtered to remove noise)
		3. Optionally, a screenshot of the current page state

		Instructions:
		- Extract information from the webpage that is relevant to the query
		- ONLY use the information available in the webpage - do not make up information
		- If the information is not available, mention that clearly
		- If the query asks for all items, list all of them

		Output:
		- Present ALL relevant information in a concise way
		- Do not use conversational format - directly output the relevant information
		- If information is unavailable, state that clearly
	`);
}

/**
 * Build a user prompt for the extraction/AI-step action.
 */
export function buildExtractionUserPrompt(
	query: string,
	statsSummary: string,
	content: string,
): string {
	return [
		`<query>\n${query}\n</query>`,
		`<content_stats>\n${statsSummary}\n</content_stats>`,
		`<webpage_content>\n${content}\n</webpage_content>`,
	].join('\n\n');
}

// ── Helpers ──

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return '';
	}
}
