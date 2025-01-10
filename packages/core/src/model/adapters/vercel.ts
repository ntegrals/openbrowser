import { generateObject, type CoreMessage, type CoreUserMessage } from 'ai';
import type { LanguageModelV1 } from 'ai';
import type { ZodType } from 'zod';
import type { LanguageModel, InferenceOptions, ModelProvider } from '../interface.js';
import type { InferenceResult, InferenceUsage } from '../types.js';
import type { Message, ContentPart } from '../messages.js';
import { ModelError, ModelThrottledError } from '../../errors.js';

export interface VercelModelAdapterOptions {
	model: LanguageModelV1;
	/** Override provider detection (otherwise inferred from model.provider or modelId). */
	provider?: ModelProvider;
	temperature?: number;
	maxTokens?: number;
	maxRetries?: number;
}

export class VercelModelAdapter implements LanguageModel {
	private readonly model: LanguageModelV1;
	private readonly defaultTemperature: number;
	private readonly defaultMaxTokens: number;
	private readonly maxRetries: number;
	private readonly _provider: ModelProvider;

	constructor(options: VercelModelAdapterOptions) {
		this.model = options.model;
		this.defaultTemperature = options.temperature ?? 0;
		this.defaultMaxTokens = options.maxTokens ?? 4096;
		this.maxRetries = options.maxRetries ?? 3;
		this._provider = options.provider ?? inferProvider(this.model.modelId, this.model.provider);
	}

	get modelId(): string {
		return this.model.modelId;
	}

	get provider(): ModelProvider {
		return this._provider;
	}

	async invoke<T>(options: InferenceOptions<T>): Promise<InferenceResult<T>> {
		const messages = this.convertMessages(options.messages);

		try {
			const result = await generateObject({
				model: this.model,
				schema: options.responseSchema as ZodType<T>,
				schemaName: options.schemaName ?? 'AgentDecision',
				schemaDescription: options.schemaDescription,
				messages,
				temperature: options.temperature ?? this.defaultTemperature,
				maxTokens: options.maxTokens ?? this.defaultMaxTokens,
				maxRetries: this.maxRetries,
			});

			const usage: InferenceUsage = {
				inputTokens: result.usage?.promptTokens ?? 0,
				outputTokens: result.usage?.completionTokens ?? 0,
				totalTokens:
					(result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
			};

			return {
				parsed: result.object,
				usage,
				finishReason: mapFinishReason(result.finishReason),
			};
		} catch (error: any) {
			if (error?.statusCode === 429 || error?.message?.includes('rate limit')) {
				const retryAfter = error?.headers?.['retry-after'];
				throw new ModelThrottledError(
					error.message ?? 'Rate limited',
					retryAfter ? Number.parseInt(retryAfter) * 1000 : undefined,
				);
			}
			throw new ModelError(
				`LLM invocation failed: ${error?.message ?? String(error)}`,
				{ cause: error },
			);
		}
	}

	private convertMessages(messages: Message[]): CoreMessage[] {
		return messages.map((msg): CoreMessage => {
			switch (msg.role) {
				case 'system':
					return { role: 'system', content: msg.content };

				case 'user': {
					if (typeof msg.content === 'string') {
						return { role: 'user', content: msg.content };
					}
					return {
						role: 'user',
						content: msg.content.map((part) => this.convertContentPart(part)),
					} as CoreUserMessage;
				}

				case 'assistant': {
					const content = typeof msg.content === 'string'
						? msg.content
						: msg.content.map((part) => {
								if (part.type === 'text') return { type: 'text' as const, text: part.text };
								return { type: 'text' as const, text: '[image]' };
							});
