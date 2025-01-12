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
