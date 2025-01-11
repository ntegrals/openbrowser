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
			const unionMembers = [...kept, catchAll] as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]];
			return z.union(unionMembers) as any;
		}
	}

	if (schema instanceof z.ZodUnion) {
		const variants = schema.options as ZodTypeAny[];
		const maxVariants = options.maxUnionVariants ?? DEFAULTS.maxUnionVariants;

		if (variants.length > maxVariants) {
			const kept = variants.slice(0, maxVariants - 1);
			const catchAll = z.object({}).passthrough().describe('Other variant');
			const unionMembers = [...kept, catchAll] as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]];
			return z.union(unionMembers) as any;
		}
	}

	return schema;
}

// ── Union collapsing ──

/**
 * When a oneOf / anyOf has more variants than maxVariants, collapse the
 * excess into a single permissive object schema.
 */
function collapseUnions(
	schema: Record<string, unknown>,
	maxVariants: number,
): Record<string, unknown> {
	schema = walkSchema(schema, (node) => {
		const unionKey = node.oneOf ? 'oneOf' : node.anyOf ? 'anyOf' : undefined;
		if (!unionKey) return node;

		const variants = node[unionKey] as Record<string, unknown>[];
		if (!Array.isArray(variants) || variants.length <= maxVariants) return node;

		// Keep the first N-1 variants, replace the rest with a permissive catch-all
		const kept = variants.slice(0, maxVariants - 1);
		const catchAll: Record<string, unknown> = {
			type: 'object',
			description: `One of ${variants.length - maxVariants + 1} additional variants (see documentation)`,
			additionalProperties: true,
		};

		return { ...node, [unionKey]: [...kept, catchAll] };
	});

	return schema;
}

// ── Enum collapsing ──

/**
 * When an enum has too many values, collapse similar values by removing
 * duplicates after case-normalization, and truncate with an annotation.
 */
function collapseEnums(
	schema: Record<string, unknown>,
	maxValues: number,
): Record<string, unknown> {
	return walkSchema(schema, (node) => {
		if (!Array.isArray(node.enum)) return node;

		const values = node.enum as unknown[];
		if (values.length <= maxValues) return node;

		// Deduplicate by lowercase string representation
		const seen = new Set<string>();
		const deduped: unknown[] = [];
		for (const v of values) {
			const key = String(v).toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				deduped.push(v);
			}
		}

		// If still too many, truncate and annotate
		if (deduped.length > maxValues) {
