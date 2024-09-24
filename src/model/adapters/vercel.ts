import type { LanguageModel } from '../interface';
import type { ModelMessage, ModelResponse, ModelOptions, ToolDefinition, ToolCall } from '../types';
import { createLogger } from '../../logging';

const logger = createLogger('model:vercel');

/**
 * Adapter for Vercel AI SDK.
 * Wraps any Vercel AI provider (OpenAI, Anthropic, Google, etc.)
 */
export class VercelModelAdapter implements LanguageModel {
  readonly name: string;
  readonly provider: string;
  private model: any;

  constructor(model: any, name?: string) {
    this.model = model;
    this.name = name ?? 'vercel-model';
    this.provider = 'vercel-ai-sdk';
  }

  async generate(
    messages: ModelMessage[],
    options: ModelOptions = {},
  ): Promise<ModelResponse> {
    const { generateText } = await import('ai');
    const result = await generateText({
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.0,
      maxTokens: options.maxTokens ?? 4096,
    });
    return {
      content: result.text,
      finishReason: result.finishReason === 'stop' ? 'stop' : 'length',
      usage: result.usage ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.promptTokens + result.usage.completionTokens,
      } : undefined,
    };
  }

  async generateWithTools(
    messages: ModelMessage[],
    tools: ToolDefinition[],
    options: ModelOptions = {},
  ): Promise<ModelResponse & { toolCalls?: ToolCall[] }> {
    const { generateText } = await import('ai');
    const aiTools: Record<string, any> = {};
    for (const tool of tools) {
      aiTools[tool.name] = { description: tool.description, parameters: tool.parameters };
    }
    const result = await generateText({
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      tools: aiTools,
      temperature: options.temperature ?? 0.0,
      maxTokens: options.maxTokens ?? 4096,
    });
    const toolCalls: ToolCall[] = result.toolCalls?.map((tc: any) => ({
      id: tc.toolCallId ?? '',
      name: tc.toolName,
      arguments: tc.args,
    })) ?? [];
    return {
      content: result.text ?? '',
      finishReason: toolCalls.length > 0 ? 'tool_calls' : (result.finishReason === 'stop' ? 'stop' : 'length'),
      usage: result.usage ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.promptTokens + result.usage.completionTokens,
      } : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
