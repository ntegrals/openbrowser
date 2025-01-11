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
			const truncated = deduped.slice(0, maxValues);
			const description = node.description
				? `${node.description} (${deduped.length - maxValues} more values omitted)`
				: `${deduped.length - maxValues} additional values omitted`;
			return { ...node, enum: truncated, description };
		}

		return { ...node, enum: deduped };
	});
}

// ── Nested object flattening ──

/**
 * Flattens objects nested beyond maxDepth by lifting nested properties
 * to the parent level with dot-separated keys.
 */
function flattenNesting(
	schema: Record<string, unknown>,
	maxDepth: number,
): Record<string, unknown> {
	return walkSchema(schema, (node) => {
		if (node.type !== 'object' || !node.properties) return node;

		const flatProps: Record<string, unknown> = {};
		const flatRequired: string[] = [];
		const origRequired = new Set(
			Array.isArray(node.required) ? (node.required as string[]) : [],
		);

		flattenProperties(
			node.properties as Record<string, Record<string, unknown>>,
			origRequired,
			'',
			0,
			maxDepth,
			flatProps,
			flatRequired,
		);

		// Only return the flattened version if we actually changed something
		const origKeys = Object.keys(node.properties as object);
		const flatKeys = Object.keys(flatProps);
		if (
			flatKeys.length === origKeys.length &&
			flatKeys.every((k) => origKeys.includes(k))
		) {
			return node;
		}

		const result: Record<string, unknown> = { ...node, properties: flatProps };
		if (flatRequired.length > 0) {
			result.required = flatRequired;
		} else {
			delete result.required;
		}
		return result;
	});
}

function flattenProperties(
	properties: Record<string, Record<string, unknown>>,
	required: Set<string>,
	prefix: string,
	currentDepth: number,
	maxDepth: number,
	out: Record<string, unknown>,
	outRequired: string[],
): void {
	for (const [key, schema] of Object.entries(properties)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		const isRequired = required.has(key);

		if (
			schema.type === 'object' &&
			schema.properties &&
			currentDepth >= maxDepth
		) {
			// Flatten: lift child properties up
			const childRequired = new Set(
				Array.isArray(schema.required) ? (schema.required as string[]) : [],
			);
			flattenProperties(
				schema.properties as Record<string, Record<string, unknown>>,
				childRequired,
				fullKey,
				currentDepth + 1,
				maxDepth,
				out,
				outRequired,
			);
		} else {
			out[fullKey] = schema;
			if (isRequired) {
				outRequired.push(fullKey);
			}
		}
	}
}

// ── Provider-specific tweaks ──

/**
 * Apply provider-specific schema modifications:
 * - Gemini: requires description on all properties
 * - OpenAI: prefers simpler schemas, removes redundant constraints
 */
function applyProviderTweaks(
	schema: Record<string, unknown>,
	provider: ModelProvider,
): Record<string, unknown> {
	switch (provider) {
		case 'google':
			return applyGeminiTweaks(schema);
		case 'openai':
			return applyOpenAITweaks(schema);
		default:
			return schema;
	}
}

/**
 * Gemini requires description fields on all object properties.
 * Without descriptions, Gemini may produce empty or incorrect output.
 */
function applyGeminiTweaks(schema: Record<string, unknown>): Record<string, unknown> {
	return walkSchema(schema, (node) => {
		if (node.type !== 'object' || !node.properties) return node;

		const props = node.properties as Record<string, Record<string, unknown>>;
		const patched: Record<string, Record<string, unknown>> = {};

		for (const [key, propSchema] of Object.entries(props)) {
			if (!propSchema.description) {
				patched[key] = {
					...propSchema,
					description: humanizePropertyName(key),
				};
			} else {
				patched[key] = propSchema;
			}
		}

		return { ...node, properties: patched };
	});
}

/**
 * OpenAI models work better with simpler schemas:
 * - Remove additionalProperties: false (it's the default for structured output)
 * - Ensure all required fields are listed
 */
function applyOpenAITweaks(schema: Record<string, unknown>): Record<string, unknown> {
	return walkSchema(schema, (node) => {
		if (node.type !== 'object') return node;

		const cleaned = { ...node };

		// OpenAI structured output doesn't need additionalProperties: false
		if (cleaned.additionalProperties === false) {
			delete cleaned.additionalProperties;
		}

		// Ensure all properties are marked required (OpenAI prefers explicit required lists)
		if (cleaned.properties && !cleaned.required) {
			cleaned.required = Object.keys(cleaned.properties as object);
		}

		return cleaned;
	});
}

// ── Schema walking utility ──

type SchemaVisitor = (node: Record<string, unknown>) => Record<string, unknown>;

/**
 * Recursively walks a JSON Schema tree, applying a visitor function
 * to each schema node (depth-first, post-order).
 */
function walkSchema(
	schema: Record<string, unknown>,
	visitor: SchemaVisitor,
): Record<string, unknown> {
	let node = { ...schema };

	// Walk into properties
	if (node.properties && typeof node.properties === 'object') {
		const props: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
			if (val && typeof val === 'object' && !Array.isArray(val)) {
				props[key] = walkSchema(val as Record<string, unknown>, visitor);
			} else {
				props[key] = val;
			}
		}
		node.properties = props;
	}

	// Walk into array items
	if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
		node.items = walkSchema(node.items as Record<string, unknown>, visitor);
	}

	// Walk into oneOf / anyOf / allOf
	for (const combiner of ['oneOf', 'anyOf', 'allOf'] as const) {
		if (Array.isArray(node[combiner])) {
			node[combiner] = (node[combiner] as Record<string, unknown>[]).map((s) =>
				typeof s === 'object' && s !== null ? walkSchema(s, visitor) : s,
			);
		}
	}

	// Walk into additionalProperties
	if (
		node.additionalProperties &&
		typeof node.additionalProperties === 'object'
	) {
		node.additionalProperties = walkSchema(
			node.additionalProperties as Record<string, unknown>,
			visitor,
		);
	}

	return visitor(node);
}

// ── Helpers ──

/**
 * Converts a camelCase or snake_case property name to a human-readable description.
 * Used for Gemini which requires descriptions on all properties.
 */
function humanizePropertyName(name: string): string {
	// Split on camelCase boundaries and underscores
	const words = name
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[_-]/g, ' ')
		.toLowerCase()
		.split(/\s+/);
