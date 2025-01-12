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
