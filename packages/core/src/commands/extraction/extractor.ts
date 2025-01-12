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
