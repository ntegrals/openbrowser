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
