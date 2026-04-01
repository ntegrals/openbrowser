/**
 * Headless vs visible browser — run with or without a visible browser window.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/headless-vs-visible.ts          # headless (default)
 *   ANTHROPIC_API_KEY=sk-... bun run examples/headless-vs-visible.ts visible  # show browser
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { Agent, Viewport, VercelModelAdapter } from 'open-browser';

const headless = process.argv[2] !== 'visible';

const anthropic = createAnthropic({});
const model = new VercelModelAdapter({
	model: anthropic('claude-haiku-4-5-20251001'),
});

const browser = new Viewport({ headless });
await browser.start();

console.log(`Browser mode: ${headless ? 'headless' : 'visible'}`);

try {
	const agent = new Agent({
		task: 'Go to https://example.com and tell me the page title',
		model,
		browser,
		settings: { stepLimit: 5 },
	});

	const result = await agent.run();
	console.log('Result:', result.finalResult);
} finally {
	await browser.close();
}
