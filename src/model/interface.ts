import type { ModelMessage, ModelResponse, ModelOptions, ToolDefinition, ToolCall } from './types';

/**
 * Abstract interface for language model providers.
 * Implementations wrap specific SDKs (OpenAI, Anthropic, etc.)
 */
export interface LanguageModel {
  readonly name: string;
  readonly provider: string;

  /**
   * Generate a text completion.
   */
  generate(
    messages: ModelMessage[],
    options?: ModelOptions,
  ): Promise<ModelResponse>;

  /**
   * Generate with tool calling support.
   */
  generateWithTools(
    messages: ModelMessage[],
    tools: ToolDefinition[],
    options?: ModelOptions,
  ): Promise<ModelResponse & { toolCalls?: ToolCall[] }>;
}
