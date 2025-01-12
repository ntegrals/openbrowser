import { z, type ZodTypeAny } from 'zod';
import type { CatalogEntry, CatalogOptions } from './types.js';
import type { CommandResult, ExecutionContext, CustomCommandSpec } from '../types.js';
import { CommandFailedError } from '../../errors.js';
import { escapeRegExp } from '../../utils.js';

// ── Special parameter names ──
// These parameter names, when found in a handler's function signature,
// are automatically injected from the ExecutionContext instead of from
// the action's validated params.

const SPECIAL_PARAMS = new Set([
	'browserSession',
	'cdpSession',
	'page',
	'domService',
	'extractionLlm',
	'fileSystem',
	'maskedValues',
]);

/**
 * Parse the parameter names from a function's source text.
 * Handles arrow functions, regular functions, destructured params, etc.
 */
function inspectHandlerParams(handler: Function): string[] {
	const source = handler.toString();

	// Match parameter list: function(a, b) / (a, b) => / async (a, b) =>
	// Also handles single param without parens: a =>
	const arrowMatch = source.match(/^(?:async\s+)?\(([^)]*)\)/);
	const funcMatch = source.match(/^(?:async\s+)?function\s*\w*\s*\(([^)]*)\)/);
	const singleParamArrow = source.match(/^(?:async\s+)?(\w+)\s*=>/);

	let paramString: string | undefined;
	if (arrowMatch) {
		paramString = arrowMatch[1];
	} else if (funcMatch) {
		paramString = funcMatch[1];
	} else if (singleParamArrow) {
		return [singleParamArrow[1]];
	}

	if (!paramString || !paramString.trim()) {
		return [];
	}

	// Split on commas, handling nested braces/brackets for destructuring
	const params: string[] = [];
	let depth = 0;
	let current = '';

	for (const char of paramString) {
		if (char === '{' || char === '[' || char === '(') {
			depth++;
			current += char;
		} else if (char === '}' || char === ']' || char === ')') {
			depth--;
			current += char;
		} else if (char === ',' && depth === 0) {
			params.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}
	if (current.trim()) {
		params.push(current.trim());
	}

	// Clean up: remove type annotations, defaults, destructuring
	return params.map((p) => {
		// Remove default values: param = defaultVal
		const withoutDefault = p.split('=')[0].trim();
		// Remove type annotations: param: Type
		const withoutType = withoutDefault.split(':')[0].trim();
		// If it's a destructured param like { a, b }, keep the braces stripped name
		// For our purposes we only care about top-level named params
		return withoutType.replace(/^[{[(]|[})\]]$/g, '').trim();
	});
}

/**
 * Detect which special parameters a handler function expects,
 * based on its parameter names (beyond the standard params + context args).
 */
function detectSpecialParams(handler: Function): Set<string> {
	const paramNames = inspectHandlerParams(handler);
	const detected = new Set<string>();
	for (const name of paramNames) {
		if (SPECIAL_PARAMS.has(name)) {
			detected.add(name);
		}
	}
	return detected;
}

/**
 * Resolve a special parameter value from the ExecutionContext.
 */
function resolveSpecialParam(
	name: string,
	context: ExecutionContext,
): unknown {
	switch (name) {
		case 'browserSession':
			return context.browserSession;
		case 'cdpSession':
			return context.cdpSession;
		case 'page':
			return context.page;
		case 'domService':
			return context.domService;
		case 'extractionLlm':
			return context.extractionLlm;
		case 'fileSystem':
			return context.fileSystem;
		case 'maskedValues':
			return context.maskedValues;
		default:
			return undefined;
	}
}

export class CommandCatalog {
	private actions = new Map<string, CatalogEntry>();
	private specialParamsCache = new Map<string, Set<string>>();
	private options: CatalogOptions;

	constructor(options?: CatalogOptions) {
		this.options = options ?? {};
	}

	register(action: CatalogEntry): void {
		if (this.options.excludeActions?.includes(action.name)) return;
		if (
			this.options.includeActions &&
			this.options.includeActions.length > 0 &&
			!this.options.includeActions.includes(action.name)
		) {
			return;
		}

		this.actions.set(action.name, action);

		// Pre-compute which special parameters the handler expects
		const specialParams = detectSpecialParams(action.handler);
		if (specialParams.size > 0) {
			this.specialParamsCache.set(action.name, specialParams);
		}
	}

	registerCustom(definition: CustomCommandSpec): void {
		this.register({
			name: definition.name,
			description: definition.description,
			schema: definition.schema,
			handler: definition.handler,
			terminatesSequence: definition.terminatesSequence,
		});
	}

	unregister(name: string): void {
		this.actions.delete(name);
		this.specialParamsCache.delete(name);
	}

	get(name: string): CatalogEntry | undefined {
		return this.actions.get(name);
	}

	has(name: string): boolean {
		return this.actions.has(name);
	}

	getAll(): CatalogEntry[] {
		return [...this.actions.values()];
	}

	getNames(): string[] {
		return [...this.actions.keys()];
	}

	async execute(
		name: string,
		params: Record<string, unknown>,
		context: ExecutionContext,
	): Promise<CommandResult> {
		const action = this.actions.get(name);
		if (!action) {
			throw new CommandFailedError(name, `Action "${name}" is not registered`);
		}

		try {
			// Validate params against schema
			const validated = action.schema.parse(params);

			// Inject special parameters from context into the validated params
			const enriched = this.injectSpecialParams(name, validated, context);

			return await action.handler(enriched, context);
		} catch (error) {
			if (error instanceof CommandFailedError) throw error;

			const message = error instanceof Error ? error.message : String(error);
			throw new CommandFailedError(name, message, {
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Return the set of special parameter names detected for a given action.
	 * Returns an empty set if no special params were detected.
	 */
	getSpecialParams(name: string): Set<string> {
		return this.specialParamsCache.get(name) ?? new Set();
	}

	/**
	 * Inject special parameters from ExecutionContext into the params object.
	 * Special params are resolved from context and merged into the params
	 * so the handler can destructure them directly from its first argument.
	 */
	private injectSpecialParams(
		actionName: string,
		params: Record<string, unknown>,
		context: ExecutionContext,
	): Record<string, unknown> {
		const specialParams = this.specialParamsCache.get(actionName);
		if (!specialParams || specialParams.size === 0) {
			return params;
		}

		const enriched = { ...params };
		for (const paramName of specialParams) {
			// Only inject if not already present in the validated params
			if (!(paramName in enriched)) {
				const value = resolveSpecialParam(paramName, context);
				if (value !== undefined) {
					enriched[paramName] = value;
				}
			}
		}
		return enriched;
	}

	buildDynamicSchema(): z.ZodType {
		const actionSchemas = this.getAll().map((action) => {
			if (action.schema instanceof z.ZodObject) {
				return action.schema.extend({
					action: z.literal(action.name),
				});
			}
			return action.schema;
		});

		if (actionSchemas.length === 0) {
			return z.object({ action: z.string() });
		}

		if (actionSchemas.length === 1) {
			return actionSchemas[0];
		}

		return z.union(actionSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
	}

	get size(): number {
		return this.actions.size;
	}

	// ── Prompt description ──

	/**
	 * Build a formatted multi-line description of all available actions.
	 * Optionally filter by page URL domain so only relevant actions appear.
	 */
	getPromptDescription(pageUrl?: string): string {
		let actions = this.getAll();

		// If a URL is provided, filter out actions whose domainFilter does not match
		if (pageUrl) {
			const domain = extractDomain(pageUrl);
			if (domain) {
				actions = actions.filter((a) => {
					// Actions without a domainFilter are always shown
					if (!a.domainFilter || a.domainFilter.length === 0) return true;
					return a.domainFilter.some(
						(pattern) =>
							domain === pattern ||
							domain.endsWith(`.${pattern}`),
					);
				});
			}
		}

		const lines: string[] = [];
		for (const action of actions) {
			const termFlag = action.terminatesSequence ? ' [terminates]' : '';
			lines.push(`- ${action.name}: ${action.description}${termFlag}`);

			// Describe the schema parameters
			if (action.schema instanceof z.ZodObject) {
				const shape = action.schema.shape as Record<string, ZodTypeAny>;
				for (const [key, zodType] of Object.entries(shape)) {
					if (key === 'action') continue;
					const desc = zodType.description ?? '';
					const isOptional = zodType.isOptional?.() ?? false;
					const optLabel = isOptional ? ' (optional)' : '';
					lines.push(`    ${key}${optLabel}: ${desc}`);
				}
			}
		}

		return lines.join('\n');
	}

	// ── Domain-based filtering ──

	/**
	 * Return actions that have a domainFilter matching the given domain,
	 * plus all actions that have no domainFilter (universal actions).
	 */
	getActionsForDomain(domain: string): CatalogEntry[] {
		const normalized = domain.replace(/^www\./, '').toLowerCase();

		return this.getAll().filter((action) => {
			if (!action.domainFilter || action.domainFilter.length === 0) return true;

			return action.domainFilter.some((pattern) => {
				const p = pattern.toLowerCase();
				return normalized === p || normalized.endsWith(`.${p}`);
			});
		});
	}

	// ── Sensitive data replacement ──

	/**
	 * Replace sensitive data values in text with `<key>` placeholders.
	 * Keys are sorted longest-value-first to avoid partial replacements.
	 */
	replaceSensitiveData(
		text: string,
		maskedValues: Record<string, string>,
	): string {
		if (!text) return text;

		// Sort entries by value length descending so longer values are replaced first
