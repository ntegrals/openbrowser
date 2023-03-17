import type { ModelMessage } from '../../model/types';

export interface ConversationState {
  messages: ModelMessage[];
  turnCount: number;
  totalTokens: number;
}

export interface ConversationOptions {
  maxMessages?: number;
  maxTokens?: number;
  systemPrompt?: string;
}
