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
