import { z } from 'zod';

export interface InferenceUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface InferenceResult<T = unknown> {
	parsed: T;
	rawText?: string;
	usage: InferenceUsage;
	finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';
}

export const InferenceUsageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
});
