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

	describe('addCommandResultMessage', () => {
		test('adds a user role message for action results', () => {
			mm.addCommandResultMessage('click: success', 1);
			const messages = mm.getMessages();
			expect(messages[0].role).toBe('user');
			expect(messages[0].content).toBe('click: success');
		});
	});

	describe('getMessages ordering', () => {
		test('returns messages in correct order', () => {
			mm.setInstructionBuilder('System prompt');
			mm.addStateMessage('State text', undefined, 1);
			mm.addAssistantMessage('Agent thought', 1);
			mm.addCommandResultMessage('Action result', 1);

			const messages = mm.getMessages();
			expect(messages).toHaveLength(4);
			expect(messages[0].role).toBe('system');
			expect(messages[1].role).toBe('user');
			expect(messages[2].role).toBe('assistant');
			expect(messages[3].role).toBe('user');
		});
	});

	describe('compaction - screenshot removal', () => {
		test('removes old screenshots when over token budget, keeps last', () => {
			// 3 screenshots: each ~1000 tokens for image + ~2 for text = ~3006 total.
			// Budget of 1500: after removing 2 old screenshots (saving 2000),
			// total becomes ~1006 < 1500, so compact exits successfully.
			const small = createManager({ contextWindowSize: 1500 });
			small.addStateMessage('State 1', 'screenshot1', 1);
			small.addStateMessage('State 2', 'screenshot2', 2);
			small.addStateMessage('State 3', 'screenshot3', 3);

			const messages = small.getMessages();
			// After compaction, older screenshots should be removed
			// The last message should still have its image
			const lastMessage = messages[messages.length - 1];
			const lastContent = lastMessage.content;
			expect(Array.isArray(lastContent)).toBe(true);
			if (Array.isArray(lastContent)) {
				const hasImage = lastContent.some(
					(p: any) => typeof p === 'object' && p.type === 'image',
				);
				expect(hasImage).toBe(true);

				// Older messages should have had their images removed
				const firstMsg = messages[0];
				const firstContent = firstMsg.content;
				if (Array.isArray(firstContent)) {
					const firstHasImage = firstContent.some(
						(p: any) => typeof p === 'object' && p.type === 'image',
					);
					expect(firstHasImage).toBe(false);
				}
			}
		});
	});

	describe('compaction - token budget behavior', () => {
		test('does not trigger compaction when under budget', () => {
			// Budget of 10000 means no compaction needed for a few messages
			const large = createManager({ contextWindowSize: 10000, includeLastScreenshot: false });
			large.addStateMessage('Short state', undefined, 1);
			large.addAssistantMessage('Short response', 1);

			const messages = large.getMessages();
			// No summaries should be present
			const summaryMessages = messages.filter(
				(m) =>
					typeof m.content === 'string' &&
					m.content.includes('omitted to save tokens'),
			);
			expect(summaryMessages).toHaveLength(0);
		});

		test('estimateTotalTokens reflects actual message content', () => {
			const mm2 = createManager({ contextWindowSize: 100000, includeLastScreenshot: false });
			mm2.addStateMessage('A'.repeat(400), undefined, 1); // ~100 tokens
			mm2.addStateMessage('B'.repeat(800), undefined, 2); // ~200 tokens

			const total = mm2.estimateTotalTokens();
			// Total should be roughly 300 tokens for 1200 chars
			expect(total).toBeGreaterThanOrEqual(250);
			expect(total).toBeLessThanOrEqual(400);
		});
	});

	describe('token estimation', () => {
		test('estimateTotalTokens includes system prompt', () => {
			mm.setInstructionBuilder('System prompt text');
			const tokensWithSystem = mm.estimateTotalTokens();
			expect(tokensWithSystem).toBeGreaterThan(0);
		});

		test('estimateTotalTokens grows with messages', () => {
			const before = mm.estimateTotalTokens();
			mm.addStateMessage('Some state text', undefined, 1);
			const after = mm.estimateTotalTokens();
			expect(after).toBeGreaterThan(before);
		});

		test('estimateTotalTokens counts images as ~1000 tokens', () => {
			mm.addStateMessage('Text', 'screenshot', 1);
			const tokens = mm.estimateTotalTokens();
			// Text ~4 chars = 1 token, plus ~1000 for image
			expect(tokens).toBeGreaterThanOrEqual(1000);
		});
	});

	describe('history items', () => {
		test('records history for each added message', () => {
			mm.addStateMessage('State text', undefined, 1);
			mm.addAssistantMessage('Agent response', 1);
			mm.addCommandResultMessage('Result text', 1);

			const items = mm.getConversationEntrys();
			expect(items).toHaveLength(3);
			expect(items[0].category).toBe('state');
			expect(items[1].category).toBe('assistant');
			expect(items[2].category).toBe('action_result');
		});

		test('history items include step number', () => {
			mm.addStateMessage('State', undefined, 5);
			const items = mm.getConversationEntrys();
			expect(items[0].step).toBe(5);
		});

		test('history items include truncated summary', () => {
			const longText = 'a'.repeat(200);
			mm.addStateMessage(longText, undefined, 1);
			const items = mm.getConversationEntrys();
			// Summary should be truncated to 120 chars
			expect(items[0].summary.length).toBeLessThanOrEqual(123); // 120 + '...'
		});

		test('history items track screenshot presence', () => {
			mm.addStateMessage('State', 'screenshot_data', 1);
			const items = mm.getConversationEntrys();
			expect(items[0].hasScreenshot).toBe(true);
		});
	});

	describe('agentHistoryDescription', () => {
		test('returns "(no history)" when empty', () => {
			expect(mm.agentHistoryDescription()).toBe('(no history)');
		});

		test('shows all steps when under stepLimitShown', () => {
			mm.addStateMessage('State 1', undefined, 1);
			mm.addAssistantMessage('Agent 1', 1);
			mm.addStateMessage('State 2', undefined, 2);
			mm.addAssistantMessage('Agent 2', 2);

			const desc = mm.agentHistoryDescription(10);
			expect(desc).toContain('Step 1:');
			expect(desc).toContain('Step 2:');
		});

		test('truncates with "steps omitted" when exceeding stepLimitShown', () => {
			for (let i = 1; i <= 20; i++) {
				mm.addStateMessage(`State ${i}`, undefined, i);
				mm.addAssistantMessage(`Agent ${i}`, i);
			}

			const desc = mm.agentHistoryDescription(4);
			expect(desc).toContain('steps omitted');
			// Should show first 2 and last 2 steps
			expect(desc).toContain('Step 1:');
			expect(desc).toContain('Step 2:');
			expect(desc).toContain('Step 19:');
			expect(desc).toContain('Step 20:');
		});

		test('includes category prefixes in description', () => {
			mm.addStateMessage('Page loaded', undefined, 1);
			mm.addAssistantMessage('Clicking button', 1);
			mm.addCommandResultMessage('click: success', 1);

			const desc = mm.agentHistoryDescription();
			expect(desc).toContain('State:');
			expect(desc).toContain('Agent:');
			expect(desc).toContain('Result:');
		});
	});

	describe('ephemeral messages', () => {
		test('ephemeral message appears in first getMessages call', () => {
			mm.addEphemeralMessage('Temporary instruction');
			const messages = mm.getMessages();
			const found = messages.some(
				(m) => typeof m.content === 'string' && m.content === 'Temporary instruction',
			);
			expect(found).toBe(true);
		});

		test('ephemeral message is removed after being consumed', () => {
			mm.addEphemeralMessage('Temp');

			// First call: message is present and gets marked as read
			const first = mm.getMessages();
			expect(first.some((m) => typeof m.content === 'string' && m.content === 'Temp')).toBe(true);

			// Second call: message is still in result (removal happens after building result),
			// then gets removed during consumeEphemeralMessages
			const second = mm.getMessages();

			// Third call: message is now actually gone from this.messages
			const third = mm.getMessages();
			const found = third.some(
				(m) => typeof m.content === 'string' && m.content === 'Temp',
			);
			expect(found).toBe(false);
		});

		test('ephemeral message with assistant role', () => {
			mm.addEphemeralMessage('Agent thought', 'assistant');
			const messages = mm.getMessages();
			const found = messages.find(
				(m) => m.role === 'assistant' && m.content === 'Agent thought',
			);
			expect(found).toBeDefined();
		});

		test('multiple ephemeral messages all appear then get cleaned up', () => {
			mm.addEphemeralMessage('Temp 1');
			mm.addEphemeralMessage('Temp 2');

			// First call: both present, marked as read
			const first = mm.getMessages();
			expect(first).toHaveLength(2);

			// Second call: still in result (removal after build), then removed
			mm.getMessages();

			// Third call: messages have been removed
			const third = mm.getMessages();
			expect(third).toHaveLength(0);
		});
	});

	describe('save / load round-trip', () => {
		test('save and load preserves system prompt', () => {
			mm.setInstructionBuilder('My system prompt');
			mm.addStateMessage('State 1', undefined, 1);

			const saved = mm.save();
			const restored = createManager();
			restored.load(saved);

			const messages = restored.getMessages();
			expect(messages[0].role).toBe('system');
			expect(messages[0].content).toBe('My system prompt');
		});

		test('save and load preserves messages', () => {
			mm.addStateMessage('State 1', undefined, 1);
			mm.addAssistantMessage('Response 1', 1);
			mm.addCommandResultMessage('Result 1', 1);

			const saved = mm.save();
			const restored = createManager();
			restored.load(saved);

			const messages = restored.getMessages();
			expect(messages).toHaveLength(3);
			expect(messages[0].role).toBe('user');
			expect(messages[1].role).toBe('assistant');
			expect(messages[2].role).toBe('user');
		});

		test('save and load preserves history items', () => {
			mm.addStateMessage('State 1', undefined, 1);
			mm.addAssistantMessage('Response 1', 1);

			const saved = mm.save();
			const restored = createManager();
			restored.load(saved);
