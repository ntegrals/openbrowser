import { test, expect, describe, beforeEach } from 'bun:test';
import { ConversationManager } from './conversation/service.js';
import type { ConversationManagerOptions } from './conversation/types.js';
import type { LanguageModel, InferenceOptions } from '../model/interface.js';
import type { InferenceResult } from '../model/types.js';

// ── Helpers ──

function createManager(
	overrides: Partial<ConversationManagerOptions> = {},
): ConversationManager {
	return new ConversationManager({
		contextWindowSize: 10000,
		includeLastScreenshot: true,
		...overrides,
	});
}

function createMockModel(summary = 'Summary of the conversation'): LanguageModel {
	return {
		modelId: 'test-model',
		provider: 'custom',
		invoke: async <T>(_options: InferenceOptions<T>): Promise<InferenceResult<T>> => {
			return {
				parsed: { summary } as unknown as T,
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				finishReason: 'stop',
			};
		},
	};
}

// ── Tests ──

describe('ConversationManager', () => {
	let mm: ConversationManager;

	beforeEach(() => {
		mm = createManager();
	});
