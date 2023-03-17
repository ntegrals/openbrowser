import type { ModelMessage } from '../../model/types';

/**
 * Rough token estimation (4 chars ≈ 1 token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens in a conversation.
 */
export function estimateConversationTokens(messages: ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/**
 * Format a tool result as a message.
 */
export function formatToolResult(toolName: string, result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return `Tool ${toolName} result:\n${text}`;
}
