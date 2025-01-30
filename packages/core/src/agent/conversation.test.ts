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

	describe('system prompt', () => {
		test('setInstructionBuilder stores the system prompt', () => {
			mm.setInstructionBuilder('You are a helpful assistant');
			const messages = mm.getMessages();
			expect(messages[0]).toEqual({
				role: 'system',
				content: 'You are a helpful assistant',
			});
		});

		test('system prompt appears first in getMessages', () => {
			mm.setInstructionBuilder('System');
			mm.addStateMessage('State text', undefined, 1);
			const messages = mm.getMessages();
			expect(messages[0].role).toBe('system');
			expect(messages[1].role).toBe('user');
		});

		test('changing system prompt replaces the previous one', () => {
			mm.setInstructionBuilder('First');
			mm.setInstructionBuilder('Second');
			const messages = mm.getMessages();
			const systemMessages = messages.filter((m) => m.role === 'system');
			expect(systemMessages).toHaveLength(1);
			expect(systemMessages[0].content).toBe('Second');
		});
	});

	describe('addStateMessage', () => {
		test('adds a user message with state text', () => {
			mm.addStateMessage('Page state info', undefined, 1);
			const messages = mm.getMessages();
			expect(messages).toHaveLength(1);
			expect(messages[0].role).toBe('user');
		});

		test('includes screenshot when provided and vision enabled', () => {
			mm.addStateMessage('State', 'base64screenshot', 1);
			const messages = mm.getMessages();
			const content = messages[0].content;
			expect(Array.isArray(content)).toBe(true);
			if (Array.isArray(content)) {
				expect(content).toHaveLength(2);
				expect(content[0]).toEqual({ type: 'text', text: 'State' });
				expect(content[1]).toHaveProperty('type', 'image');
			}
		});

		test('excludes screenshot when vision disabled', () => {
			const noVision = createManager({ includeLastScreenshot: false });
			noVision.addStateMessage('State', 'base64screenshot', 1);
			const messages = noVision.getMessages();
			const content = messages[0].content;
			// Content should be text-only array
			expect(Array.isArray(content)).toBe(true);
			if (Array.isArray(content)) {
				expect(content).toHaveLength(1);
				expect(content[0]).toHaveProperty('type', 'text');
			}
		});

		test('updates messageCount', () => {
			expect(mm.messageCount).toBe(0);
			mm.addStateMessage('State 1', undefined, 1);
			expect(mm.messageCount).toBe(1);
			mm.addStateMessage('State 2', undefined, 2);
			expect(mm.messageCount).toBe(2);
		});
	});

	describe('addAssistantMessage', () => {
		test('adds an assistant role message', () => {
			mm.addAssistantMessage('Agent response', 1);
			const messages = mm.getMessages();
			expect(messages[0].role).toBe('assistant');
			expect(messages[0].content).toBe('Agent response');
		});
	});

