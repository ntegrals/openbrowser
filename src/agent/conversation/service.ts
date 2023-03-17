import type { ModelMessage } from '../../model/types';
import type { ConversationState, ConversationOptions } from './types';
import { createLogger } from '../../logging';

const logger = createLogger('conversation');

/**
 * Manages the conversation history for the agent loop.
 * Handles truncation when the context window fills up.
 */
export class ConversationManager {
  private messages: ModelMessage[] = [];
  private turnCount = 0;
  private totalTokens = 0;
  private readonly maxMessages: number;
  private readonly maxTokens: number;
  private systemPrompt?: string;

  constructor(options: ConversationOptions = {}) {
    this.maxMessages = options.maxMessages ?? 100;
    this.maxTokens = options.maxTokens ?? 128000;
    this.systemPrompt = options.systemPrompt;
  }

  addMessage(message: ModelMessage): void {
    this.messages.push(message);
    if (message.role !== 'system') {
      this.turnCount++;
    }
    this.pruneIfNeeded();
  }

  getMessages(): ModelMessage[] {
    const result: ModelMessage[] = [];
    if (this.systemPrompt) {
      result.push({ role: 'system', content: this.systemPrompt });
    }
    result.push(...this.messages);
    return result;
  }

  getState(): ConversationState {
    return {
      messages: [...this.messages],
      turnCount: this.turnCount,
      totalTokens: this.totalTokens,
    };
  }

  updateTokenCount(tokens: number): void {
    this.totalTokens += tokens;
  }

  clear(): void {
    this.messages = [];
    this.turnCount = 0;
    this.totalTokens = 0;
  }

  private pruneIfNeeded(): void {
    // Simple strategy: keep last N messages
    if (this.messages.length > this.maxMessages) {
      const excess = this.messages.length - this.maxMessages;
      this.messages = this.messages.slice(excess);
      logger.debug(`Pruned ${excess} old messages`);
    }
  }
}
