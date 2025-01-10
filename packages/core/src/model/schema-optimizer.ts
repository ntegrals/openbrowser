import { z, type ZodTypeAny } from 'zod';
import type { ModelProvider } from './interface.js';

// ── Configuration ──

export interface SchemaOptimizationOptions {
	/** LLM provider to apply provider-specific tweaks for. */
	provider?: ModelProvider;

	/**
	 * Maximum number of variants in a discriminated union before collapsing
	 * infrequently used ones into a generic fallback.
	 */
	maxUnionVariants?: number;

	/**
	 * Maximum nesting depth before flattening deeply nested objects
	 * into dot-separated flat keys.
	 */
	maxNestingDepth?: number;

	/**
	 * Maximum number of enum values before collapsing similar ones.
	 */
	maxEnumValues?: number;
}

const DEFAULTS: Required<Omit<SchemaOptimizationOptions, 'provider'>> = {
	maxUnionVariants: 15,
	maxNestingDepth: 4,
	maxEnumValues: 30,
};

// ── Main entry point ──

/**
 * Optimizes a JSON Schema (as a plain object) for LLM consumption.
 * Applies union collapsing, enum simplification, provider-specific tweaks,
 * and nested object flattening.
 */
export function optimizeJsonSchemaForModel(
	schema: Record<string, unknown>,
	options: SchemaOptimizationOptions = {},
): Record<string, unknown> {
	const opts = { ...DEFAULTS, ...options };
	let result = structuredClone(schema);

	result = collapseUnions(result, opts.maxUnionVariants);
	result = collapseEnums(result, opts.maxEnumValues);
	result = flattenNesting(result, opts.maxNestingDepth);

	if (opts.provider) {
		result = applyProviderTweaks(result, opts.provider);
	}

	return result;
}

/**
 * Optimizes Zod schemas for LLM consumption by simplifying complex unions
 * and removing unnecessary constraints that confuse models.
 *
 * This works at the Zod level for simple transformations, but for deeper
 * optimization, convert to JSON Schema first with zodToJsonSchema() and
 * then call optimizeJsonSchemaForModel().
 */
export function optimizeSchemaForModel<T extends ZodTypeAny>(
	schema: T,
	options: SchemaOptimizationOptions = {},
): T {
	// For discriminated unions with too many variants, wrap in a transformation
	// that strips the union down. We operate at the Zod type level where possible.
	if (schema instanceof z.ZodDiscriminatedUnion) {
		const variants = [...schema.options.values()] as ZodTypeAny[];
		const maxVariants = options.maxUnionVariants ?? DEFAULTS.maxUnionVariants;

		if (variants.length > maxVariants) {
			// Keep the first maxVariants-1 variants and add a catch-all object
			const kept = variants.slice(0, maxVariants - 1);
			const catchAll = z.object({}).passthrough().describe('Other action (see documentation)');
