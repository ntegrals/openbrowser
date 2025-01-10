import type { ZodType } from 'zod';
import type { Message } from './messages.js';
import type { InferenceResult } from './types.js';

/** Known LLM provider identifiers. */
export type ModelProvider =
	| 'anthropic'
	| 'openai'
	| 'google'
	| 'mistral'
	| 'deepseek'
	| 'groq'
	| 'fireworks'
	| 'together'
	| 'custom';

export interface InferenceOptions<T> {
	messages: Message[];
	responseSchema: ZodType<T>;
	schemaName?: string;
	schemaDescription?: string;
	temperature?: number;
	maxTokens?: number;

	/**
	 * Token budget for extended thinking / chain-of-thought.
	 * Only honored by models that support thinking (Claude 3.5+, o1, etc.).
	 * Set to 0 to disable thinking even when the model supports it.
	 */
	thinkingBudget?: number;

	/**
	 * Enable prompt caching for this call. When true, the adapter should
	 * set cache-control headers / parameters where the provider supports it
	 * (e.g. Anthropic prompt caching, OpenAI predicted outputs).
	 */
	cache?: boolean;

	/**
	 * Per-call timeout in milliseconds. Overrides any default timeout
	 * configured on the LanguageModel instance.
	 */
	timeout?: number;
}

export interface LanguageModel {
	invoke<T>(options: InferenceOptions<T>): Promise<InferenceResult<T>>;

	/** The model identifier string (e.g. "claude-3-5-sonnet-20241022"). */
	readonly modelId: string;

	/** The LLM provider this model belongs to. */
	readonly provider: ModelProvider;
}
