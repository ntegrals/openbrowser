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
