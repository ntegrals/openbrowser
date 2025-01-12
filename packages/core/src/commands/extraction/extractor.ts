import type { Page } from 'playwright';
import type { LanguageModel } from '../../model/interface.js';
import { z } from 'zod';
import {
	extractMarkdown,
	chunkText,
	extractLinks as extractPageLinks,
} from '../../page/content-extractor.js';
import { systemMessage, userMessage } from '../../model/messages.js';

const ExtractionResultSchema = z.object({
	content: z.string().describe('The extracted information'),
	confidence: z.number().min(0).max(1).describe('Confidence in the extraction (0-1)'),
});

type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export class ContentExtractor {
	private model: LanguageModel;

	constructor(model: LanguageModel) {
		this.model = model;
	}

	async extract(page: Page, goal: string, startFromChar?: number): Promise<string> {
		const markdown = await extractMarkdown(page, {
			startFromChar: startFromChar && startFromChar > 0 ? startFromChar : undefined,
		});

		if (!markdown.trim()) {
			return 'No content found on the page.';
		}

		// For short pages, extract directly
		if (markdown.length <= 8000) {
			return this.extractFromText(markdown, goal);
		}

		// For longer pages, chunk and extract from each chunk
		const chunks = chunkText(markdown, 6000);
		const results: string[] = [];

		for (const chunk of chunks) {
			const result = await this.extractFromText(chunk, goal);
			if (result && result !== 'No relevant information found.') {
				results.push(result);
			}
		}

		if (results.length === 0) {
			return 'No relevant information found on the page.';
		}

		if (results.length === 1) {
			return results[0];
		}

		// Combine results
		return this.combineExtractions(results, goal);
	}

	// ── Structured extraction ──

	/**
	 * Extract information from a page and validate against a Zod schema.
	 * The LLM is prompted to return JSON conforming to the schema, then the
	 * output is parsed/validated with Zod.
	 */
	async extractStructured<T>(
		page: Page,
		goal: string,
		schema: z.ZodType<T>,
	): Promise<T> {
		const markdown = await extractMarkdown(page);

		if (!markdown.trim()) {
			throw new Error('No content found on the page for structured extraction.');
		}

		// Build a JSON schema description for the prompt
		const schemaDescription =
			schema instanceof z.ZodObject
				? JSON.stringify(
						(schema as z.ZodObject<z.ZodRawShape>).shape,
						(_key, value) => {
							if (value?._def?.description) return `(${value._def.description})`;
							if (value?._def?.typeName) return value._def.typeName;
							return value;
						},
						2,
					)
				: 'See schema constraints';

		const text = markdown.length > 8000 ? markdown.slice(0, 8000) : markdown;

		const StructuredOutputSchema = z.object({
			result: z.string().describe('JSON string conforming to the requested schema'),
		});

		const response = await this.model.invoke({
			messages: [
				systemMessage(
					'You are a precise information extractor. Extract the requested information from the provided text and return it as a valid JSON string in the "result" field. The JSON must conform to the schema described below.',
				),
				userMessage(
					`Goal: ${goal}\n\nExpected schema:\n${schemaDescription}\n\nText content:\n${text}\n\nReturn the extracted data as a JSON string in the "result" field.`,
				),
			],
			responseSchema: StructuredOutputSchema,
			schemaName: 'StructuredOutput',
			temperature: 0,
		});

		const parsed = JSON.parse(response.parsed.result);
		return schema.parse(parsed);
	}

	// ── Link extraction ──

	/**
