import type { Message } from '../../model/messages.js';
import type { CompactionPolicy } from '../types.js';
import type { LanguageModel } from '../../model/interface.js';

// ── Message Manager Options ──

export interface ConversationManagerOptions {
	contextWindowSize: number;
	estimateTokens?: (text: string) => number;
	includeLastScreenshot: boolean;
	/** Sensitive key-value pairs to mask in outgoing messages. */
	maskedValues?: Record<string, string>;
	/** LLM-based compaction configuration. */
	compaction?: CompactionPolicy;
	/** LanguageModel used for LLM-based compaction. Ignored if compaction is not set. */
	compactionModel?: LanguageModel;
}

// ── Managed Message ──

export type MessageCategory =
	| 'system'
	| 'state'
	| 'action_result'
	| 'assistant'
	| 'user'
	| 'compaction_summary';

export interface TrackedMessage {
	message: Message;
	isCompactable: boolean;
	tokenEstimate: number;
	step?: number;
	/** Semantic category for structured history tracking. */
	category?: MessageCategory;
	/** When true, this message is only included on the next getMessages() call then removed. */
	ephemeral?: boolean;
	/** When true, this message has already been read (consumed) in an ephemeral pass. */
	ephemeralRead?: boolean;
	/** Timestamp when this message was added. */
	addedAt?: number;
}

// ── History Item ──

/**
 * A structured entry in the agent's conversation history, richer than TrackedMessage.
 * Used for building human-readable summaries and for save/load.
 */
export interface ConversationEntry {
	/** Step number this item belongs to. */
	step: number;
	/** Category of this history item. */
	category: MessageCategory;
	/** Brief human-readable summary of this item (e.g. "Clicked element 5" or "Navigated to google.com"). */
	summary: string;
	/** The full text content (truncated for large payloads). */
	content?: string;
	/** Whether this item included a screenshot. */
	hasScreenshot?: boolean;
	/** Timestamp. */
	timestamp: number;
}

// ── Message Manager State (persistence) ──

/**
 * Serializable snapshot of the ConversationManager for save/load.
 */
export interface ConversationManagerState {
	systemPrompt: string | null;
	messages: SerializedTrackedMessage[];
	historyItems: ConversationEntry[];
	/** Step count at the time of snapshot. */
	currentStep: number;
}

/**
 * Serializable form of TrackedMessage (Message content may contain base64
 * screenshots, which are replaced with placeholders during serialization).
 */
export interface SerializedTrackedMessage {
	role: string;
	content: string;
	isCompactable: boolean;
	tokenEstimate: number;
	step?: number;
	category?: MessageCategory;
}
