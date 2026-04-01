/**
 * Structured data extraction — extract typed data from a web page using a Zod schema.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/extract-data.ts
 */
import { z } from 'zod';
import { createAnthropic } from '@ai-sdk/anthropic';
import { Agent, Viewport, VercelModelAdapter } from 'open-browser';

const anthropic = createAnthropic({});
const model = new VercelModelAdapter({
	model: anthropic('claude-haiku-4-5-20251001'),
});

const browser = new Viewport({ headless: true });
await browser.start();

try {
	const agent = new Agent({
		task: `Go to https://news.ycombinator.com and extract the top 5 stories.
For each story, get the title, URL, points, and number of comments.
Return the data as your final result.`,
		model,
		browser,
		settings: {
			stepLimit: 10,
		},
	});

	const result = await agent.run();

	if (result.success && result.finalResult) {
		console.log('Extracted data:');
		console.log(result.finalResult);
	} else {
		console.error('Extraction failed:', result.errors);
	}
} finally {
	await browser.close();
}
