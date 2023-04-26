import type { ModelMessage } from './types';

/**
 * Create a system message.
 */
export function systemMessage(content: string): ModelMessage {
  return { role: 'system', content };
}

/**
 * Create a user message.
 */
export function userMessage(content: string): ModelMessage {
  return { role: 'user', content };
}

/**
 * Create an assistant message.
 */
export function assistantMessage(content: string): ModelMessage {
  return { role: 'assistant', content };
}

/**
 * Format messages array for logging/debugging.
 */
export function formatMessages(messages: ModelMessage[]): string {
  return messages
    .map(m => `[${m.role}] ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`)
    .join('\n');
}
