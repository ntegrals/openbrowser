import { chromium } from 'playwright';
import { extractMarkdown } from './src/page/content-extractor.js';

async function main() {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	const page = await context.newPage();

	await page.goto('https://news.ycombinator.com', { waitUntil: 'networkidle' });

	try {
		console.log('Extracting markdown...');
		const markdown = await extractMarkdown(page);
		console.log('Markdown length:', markdown.length);
		console.log('First 500 chars:', markdown.slice(0, 500));
	} catch (error) {
		console.error('extractMarkdown error:', error);
	}

	// Now try invoking the model via the ContentExtractor
	try {
		const { createOpenAI } = await import('@ai-sdk/openai');
		const { VercelModelAdapter } = await import('./src/model/adapters/vercel.js');
		const { ContentExtractor } = await import('./src/commands/extraction/extractor.js');

		const openai = createOpenAI({});
		const model = new VercelModelAdapter({ model: openai('gpt-4o') });
		const extractor = new ContentExtractor(model);

		console.log('\nExtracting with LLM...');
		const result = await extractor.extract(page, 'List the top 5 story titles');
		console.log('Result:', result);
	} catch (error: any) {
		console.error('ContentExtractor error:', error?.message ?? error);
		console.error('Stack:', error?.stack);
	}

	await browser.close();
}

main().catch(console.error);
