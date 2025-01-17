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
			tokenEstimate: estimateTokens(text),
			category: role === 'user' ? 'user' : 'assistant',
			ephemeral: true,
			ephemeralRead: false,
			addedAt: Date.now(),
		});
	}

	// ────────────────────────────────────────
	//  Get Messages (with compaction + filtering)
	// ────────────────────────────────────────

	getMessages(): Message[] {
		const result: Message[] = [];

		if (this.systemPromptMessage) {
			result.push(this.systemPromptMessage);
		}

		// Check if we need to compact
		const totalTokens = this.estimateTotalTokens();
		if (totalTokens > this.options.contextWindowSize) {
			this.compact();
		}

		for (const managed of this.messages) {
			result.push(managed.message);
		}

		// Mark ephemeral messages as read so they can be cleaned up
		this.consumeEphemeralMessages();

		// Apply sensitive data filtering
		if (this.options.maskedValues && Object.keys(this.options.maskedValues).length > 0) {
			return redactMessages(result, this.options.maskedValues);
		}

		return result;
	}

	// ────────────────────────────────────────
	//  Ephemeral Message Lifecycle
	// ────────────────────────────────────────

	/**
	 * After getMessages() has been called, remove ephemeral messages that were already read.
	 * Freshly-added ephemeral messages are marked as read (so they survive one getMessages call).
	 */
	private consumeEphemeralMessages(): void {
		// Remove previously-read ephemeral messages
		this.messages = this.messages.filter(
			(m) => !(m.ephemeral && m.ephemeralRead),
		);

		// Mark remaining ephemeral messages as read for the next pass
		for (const m of this.messages) {
			if (m.ephemeral && !m.ephemeralRead) {
				m.ephemeralRead = true;
			}
		}
	}

	// ────────────────────────────────────────
	//  Token Estimation
	// ────────────────────────────────────────

	estimateTotalTokens(): number {
		let total = 0;
		if (this.systemPromptMessage) {
			total += estimateTokens(
				typeof this.systemPromptMessage.content === 'string'
					? this.systemPromptMessage.content
					: '',
			);
		}
		for (const managed of this.messages) {
			total += managed.tokenEstimate;
		}
		return total;
	}

	// ────────────────────────────────────────
	//  Basic Compaction (image removal + old message replacement)
	// ────────────────────────────────────────

	private compact(): void {
		// Remove screenshots from older messages (keep only last)
		let foundLast = false;
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const msg = this.messages[i];
			if (!msg.isCompactable) continue;

			const content = msg.message.content;
			if (Array.isArray(content)) {
				const hasImage = content.some(
					(p) => typeof p === 'object' && p !== null && (p as ContentPart).type === 'image',
				);
				if (hasImage) {
					if (foundLast) {
						// Remove images from this message
						const filtered = content.filter(
							(p) =>
								typeof p !== 'object' ||
								p === null ||
								(p as ContentPart).type !== 'image',
						);
						if (filtered.length > 0) {
							msg.message = userMessage(filtered as ContentPart[]);
							msg.tokenEstimate = estimateMessageTokens(filtered);
						}
					} else {
						foundLast = true;
					}
				}
			}
		}

		// If still over budget, remove old compactable state messages
		while (
			this.estimateTotalTokens() > this.options.contextWindowSize &&
			this.messages.length > 4
		) {
			// Find first compactable message
			const idx = this.messages.findIndex((m) => m.isCompactable);
			if (idx === -1) break;

			// Replace with a summary
			const removed = this.messages.splice(idx, 1)[0];
			const summary = `[Step ${removed.step ?? '?'} state omitted to save tokens]`;
			this.messages.splice(idx, 0, {
				message: userMessage(summary),
				isCompactable: true,
				tokenEstimate: estimateTokens(summary),
				step: removed.step,
				category: 'compaction_summary',
				addedAt: Date.now(),
			});
		}
	}

	// ────────────────────────────────────────
	//  LLM-Based Compaction
	// ────────────────────────────────────────

	/**
	 * Run LLM-based message compaction: send the older portion of the conversation
	 * to a summarization model and replace it with a single summary message.
	 *
	 * Call this periodically (e.g. every N steps as configured in compaction.interval).
	 * Returns true if compaction was performed, false if skipped.
	 */
	async compactWithLlm(model?: LanguageModel): Promise<boolean> {
		const compactionConfig = this.options.compaction;
		if (!compactionConfig) return false;

		const llm = model ?? this.options.compactionModel;
		if (!llm) return false;

		// Only compact if enough steps have passed since last compaction
		if (
			compactionConfig.interval > 0 &&
			this.currentStep - this.lastCompactionStep < compactionConfig.interval
		) {
			return false;
		}

		const targetTokens =
			compactionConfig.targetTokens ??
			Math.floor(this.options.contextWindowSize * 0.6);

		// If we're under the target, no need to compact
		if (this.estimateTotalTokens() <= targetTokens) return false;

		// Split messages: keep the last few messages intact, summarize the rest
		const keepCount = Math.min(6, Math.floor(this.messages.length / 2));
		const toSummarize = this.messages.slice(0, this.messages.length - keepCount);
		const toKeep = this.messages.slice(this.messages.length - keepCount);

		if (toSummarize.length === 0) return false;

		// Build a transcript of the messages to summarize
		const transcript = toSummarize
			.map((m) => {
				const role = m.message.role;
				const text = extractTextContent(m.message);
				const stepLabel = m.step !== undefined ? ` (step ${m.step})` : '';
				return `[${role}${stepLabel}]: ${truncate(text, 500)}`;
			})
			.join('\n');

		const prompt = [
			systemMessage(
				'You are a conversation summarizer. Summarize the following agent-browser conversation transcript. ' +
				'Preserve key facts: URLs visited, actions taken, errors encountered, extracted data, and the current task state. ' +
				'Be concise but complete.',
			),
			userMessage(
				`Summarize this conversation transcript:\n\n${transcript}`,
			),
		];

		try {
			const completion = await llm.invoke({
				messages: prompt,
				responseSchema: CompactionSummarySchema,
				schemaName: 'CompactionSummary',
				schemaDescription: 'A concise summary of the conversation so far',
				maxTokens: compactionConfig.maxTokens,
				temperature: 0,
			});

			const summaryText = `[Conversation summary of steps 1-${toSummarize[toSummarize.length - 1]?.step ?? '?'}]\n${completion.parsed.summary}`;

			// Replace the summarized messages with a single summary
			this.messages = [
				{
					message: userMessage(summaryText),
					isCompactable: false, // Don't re-compact the summary
					tokenEstimate: estimateTokens(summaryText),
					category: 'compaction_summary',
					addedAt: Date.now(),
				},
				...toKeep,
			];

			this.lastCompactionStep = this.currentStep;
			return true;
		} catch {
			// If LLM compaction fails, fall back to basic compaction silently
			return false;
		}
	}

	/**
	 * Check whether LLM compaction should run at the current step.
	 * This is a convenience check; the caller can use it to decide whether
	 * to call compactWithLlm().
	 */
	shouldCompactWithLlm(): boolean {
		const config = this.options.compaction;
		if (!config || config.interval <= 0) return false;
		return (
			this.currentStep - this.lastCompactionStep >= config.interval &&
			this.estimateTotalTokens() > (config.targetTokens ?? this.options.contextWindowSize * 0.6)
		);
	}

	// ────────────────────────────────────────
	//  History Items & Description
	// ────────────────────────────────────────

	private recordConversationEntry(
		step: number,
		category: MessageCategory,
		content: string,
		hasScreenshot?: boolean,
	): void {
		this.historyItems.push({
			step,
			category,
			summary: truncate(content, 120),
			content: truncate(content, 2000),
			hasScreenshot,
			timestamp: Date.now(),
		});
	}

	/**
	 * Build a human-readable description of the agent's history,
	 * with "N steps omitted" truncation for long histories.
	 *
	 * @param stepLimitShown Maximum number of steps to show in full detail.
	 *   If the history is longer, middle steps are replaced with a "N steps omitted" line.
	 */
	agentHistoryDescription(stepLimitShown = 10): string {
		// Group history items by step
		const byStep = new Map<number, ConversationEntry[]>();
		for (const item of this.historyItems) {
			const existing = byStep.get(item.step);
			if (existing) {
				existing.push(item);
			} else {
				byStep.set(item.step, [item]);
			}
		}

		const stepNumbers = [...byStep.keys()].sort((a, b) => a - b);
		if (stepNumbers.length === 0) return '(no history)';

		const lines: string[] = [];

		if (stepNumbers.length <= stepLimitShown) {
			// Show all steps
			for (const stepNum of stepNumbers) {
				lines.push(this.formatStepDescription(stepNum, byStep.get(stepNum)!));
			}
		} else {
			// Show first few, omitted middle, last few
			const headCount = Math.ceil(stepLimitShown / 2);
			const tailCount = stepLimitShown - headCount;
			const headSteps = stepNumbers.slice(0, headCount);
			const tailSteps = stepNumbers.slice(stepNumbers.length - tailCount);
			const omittedCount = stepNumbers.length - headCount - tailCount;

			for (const stepNum of headSteps) {
				lines.push(this.formatStepDescription(stepNum, byStep.get(stepNum)!));
			}

			lines.push(`  ... (${omittedCount} steps omitted) ...`);

			for (const stepNum of tailSteps) {
				lines.push(this.formatStepDescription(stepNum, byStep.get(stepNum)!));
			}
		}

		return lines.join('\n');
	}

	private formatStepDescription(step: number, items: ConversationEntry[]): string {
		const parts = items.map((item) => {
			const prefix = item.category === 'state' ? 'State' :
				item.category === 'assistant' ? 'Agent' :
				item.category === 'action_result' ? 'Result' :
				item.category === 'user' ? 'User' : item.category;
			return `${prefix}: ${item.summary}`;
		});
		return `Step ${step}:\n  ${parts.join('\n  ')}`;
	}

	/** Get all recorded history items. */
	getConversationEntrys(): readonly ConversationEntry[] {
		return this.historyItems;
	}

	// ────────────────────────────────────────
	//  Save / Load (Conversation Persistence)
	// ────────────────────────────────────────

	/**
	 * Serialize the current state to a persistence-friendly snapshot.
	 * Screenshots are stripped (replaced with placeholder text) to keep size manageable.
	 */
	save(): ConversationManagerState {
		const serialized: SerializedTrackedMessage[] = this.messages.map((m) => ({
			role: m.message.role,
			content: extractTextContent(m.message),
			isCompactable: m.isCompactable,
			tokenEstimate: m.tokenEstimate,
			step: m.step,
			category: m.category,
		}));

		return {
			systemPrompt: this.systemPromptText,
			messages: serialized,
			historyItems: [...this.historyItems],
			currentStep: this.currentStep,
		};
	}

	/**
	 * Restore the ConversationManager from a previously saved state.
	 * This replaces all current messages and history.
	 */
	load(state: ConversationManagerState): void {
		if (state.systemPrompt) {
			this.setInstructionBuilder(state.systemPrompt);
		} else {
			this.systemPromptMessage = null;
			this.systemPromptText = null;
		}

		this.messages = state.messages.map((s) => ({
			message:
				s.role === 'assistant'
					? assistantMessage(s.content)
					: userMessage(s.content),
			isCompactable: s.isCompactable,
			tokenEstimate: s.tokenEstimate,
			step: s.step,
			category: s.category,
			addedAt: Date.now(),
		}));

		this.historyItems = [...state.historyItems];
		this.currentStep = state.currentStep;
	}

	/**
	 * Save the conversation state to a JSON file.
	 */
	async saveToFile(filePath: string): Promise<string> {
		const { writeFile, mkdir } = await import('node:fs/promises');
		const { dirname } = await import('node:path');
		await mkdir(dirname(filePath), { recursive: true });
		const json = JSON.stringify(this.save(), null, 2);
		await writeFile(filePath, json, 'utf-8');
		return filePath;
	}

	/**
	 * Load conversation state from a JSON file.
	 */
	async loadFromFile(filePath: string): Promise<void> {
		const { readFile } = await import('node:fs/promises');
		const raw = await readFile(filePath, 'utf-8');
		const state = JSON.parse(raw) as ConversationManagerState;
		this.load(state);
	}

	// ────────────────────────────────────────
	//  Accessors
	// ────────────────────────────────────────

	get messageCount(): number {
		return this.messages.length + (this.systemPromptMessage ? 1 : 0);
	}

	get step(): number {
		return this.currentStep;
	}

	clear(): void {
		this.messages = [];
		this.historyItems = [];
		this.currentStep = 0;
		this.lastCompactionStep = 0;
	}

	/**
	 * Remove all messages but preserve history items and step counter.
	 * Useful when restarting message context without losing the history summary.
	 */
	resetMessages(): void {
		this.messages = [];
		this.lastCompactionStep = 0;
	}
}
