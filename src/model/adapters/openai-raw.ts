import type { LanguageModel } from '../interface';
import type { ModelMessage, ModelResponse, ModelOptions, ToolDefinition, ToolCall } from '../types';
import { createLogger } from '../../logging';

const logger = createLogger('model:openai');

/**
 * Raw OpenAI API adapter using fetch.
 * This is a temporary implementation before migrating to Vercel AI SDK.
 */
export class OpenAIRawAdapter implements LanguageModel {
  readonly name: string;
  readonly provider = 'openai';
  private apiKey: string;
  private baseUrl: string;

  constructor(options: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  } = {}) {
    this.name = options.model ?? 'gpt-4';
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  }

  async generate(
    messages: ModelMessage[],
    options: ModelOptions = {},
  ): Promise<ModelResponse> {
    const response = await this.callApi(messages, undefined, options);
    return response;
  }

  async generateWithTools(
    messages: ModelMessage[],
    tools: ToolDefinition[],
    options: ModelOptions = {},
  ): Promise<ModelResponse & { toolCalls?: ToolCall[] }> {
    return this.callApi(messages, tools, options);
  }

  private async callApi(
    messages: ModelMessage[],
    tools: ToolDefinition[] | undefined,
    options: ModelOptions,
  ): Promise<ModelResponse & { toolCalls?: ToolCall[] }> {
    const body: any = {
      model: this.name,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.0,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    if (options.stopSequences) {
      body.stop = options.stopSequences;
    }

    logger.debug(`Calling OpenAI API: ${this.name}`);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${text}`);
    }

    const data = await response.json() as any;
    const choice = data.choices[0];

    const result: ModelResponse & { toolCalls?: ToolCall[] } = {
      content: choice.message.content ?? '',
      finishReason: choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason === 'length' ? 'length' : 'tool_calls',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };

    if (choice.message.tool_calls) {
      result.toolCalls = choice.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return result;
  }
}
