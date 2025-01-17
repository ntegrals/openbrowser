import { z } from 'zod';
import type { Message } from '../../model/messages.js';
import {
	systemMessage,
	userMessage,
	assistantMessage,
	imageContent,
	textContent,
	type ContentPart,
} from '../../model/messages.js';
import type { LanguageModel } from '../../model/interface.js';
import type {
	ConversationManagerOptions,
	TrackedMessage,
	ConversationManagerState,
	ConversationEntry,
	SerializedTrackedMessage,
	MessageCategory,
} from './types.js';
import {
	estimateTokens,
	estimateMessageTokens,
	redactMessages,
	extractTextContent,
	truncate,
} from './utils.js';

// ── LLM Compaction Summary Schema ──

const CompactionSummarySchema = z.object({
	summary: z.string().describe('Concise summary of the conversation so far'),
});

// ── ConversationManager ──

export class ConversationManager {
	private messages: TrackedMessage[] = [];
	private systemPromptMessage: Message | null = null;
	private systemPromptText: string | null = null;
	private options: ConversationManagerOptions;
	private historyItems: ConversationEntry[] = [];
	private currentStep = 0;
	private lastCompactionStep = 0;

	constructor(options: ConversationManagerOptions) {
		this.options = options;
	}

	// ────────────────────────────────────────
	//  System Prompt
	// ────────────────────────────────────────

	setInstructionBuilder(prompt: string): void {
		this.systemPromptText = prompt;
		this.systemPromptMessage = systemMessage(prompt);
	}

	// ────────────────────────────────────────
	//  Add Messages
	// ────────────────────────────────────────

	addStateMessage(
		stateText: string,
		screenshot?: string,
		step?: number,
	): void {
		const content: ContentPart[] = [textContent(stateText)];

		if (screenshot && this.options.includeLastScreenshot) {
			content.push(imageContent(screenshot, 'image/png'));
		}

		if (step !== undefined) this.currentStep = step;

		this.messages.push({
			message: userMessage(content),
			isCompactable: true,
			tokenEstimate: estimateMessageTokens(content),
			step,
			category: 'state',
			addedAt: Date.now(),
		});

		this.recordConversationEntry(step ?? this.currentStep, 'state', stateText, !!screenshot);
	}

	addAssistantMessage(text: string, step?: number): void {
		if (step !== undefined) this.currentStep = step;

		this.messages.push({
			message: assistantMessage(text),
			isCompactable: true,
			tokenEstimate: estimateTokens(text),
			step,
			category: 'assistant',
			addedAt: Date.now(),
		});

		this.recordConversationEntry(step ?? this.currentStep, 'assistant', text);
	}

	addCommandResultMessage(text: string, step?: number): void {
		if (step !== undefined) this.currentStep = step;

		this.messages.push({
			message: userMessage(text),
			isCompactable: true,
			tokenEstimate: estimateTokens(text),
			step,
			category: 'action_result',
			addedAt: Date.now(),
		});

		this.recordConversationEntry(step ?? this.currentStep, 'action_result', text);
	}

	addUserMessage(text: string): void {
		this.messages.push({
			message: userMessage(text),
			isCompactable: false,
			tokenEstimate: estimateTokens(text),
			category: 'user',
			addedAt: Date.now(),
		});

		this.recordConversationEntry(this.currentStep, 'user', text);
	}

	/**
	 * Add an ephemeral message that is included in the next getMessages() call
	 * and then automatically removed. Useful for one-shot instructions or
	 * temporary context that should not persist across steps.
	 */
	addEphemeralMessage(text: string, role: 'user' | 'assistant' = 'user'): void {
		const msg =
			role === 'user' ? userMessage(text) : assistantMessage(text);

		this.messages.push({
			message: msg,
			isCompactable: false,
