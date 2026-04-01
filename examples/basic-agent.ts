/**
 * Basic agent example — give a task in natural language and let the agent complete it.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/basic-agent.ts
 */
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
		task: 'Go to https://news.ycombinator.com and tell me the title of the top story',
		model,
		browser,
		settings: {
			stepLimit: 10,
		},
	});

	const result = await agent.run();

	console.log('Success:', result.success);
	console.log('Result:', result.finalResult);

	if (result.totalCost) {
		console.log(`Cost: $${result.totalCost.totalCost.toFixed(4)}`);
		console.log(`Tokens: ${result.totalCost.totalInputTokens + result.totalCost.totalOutputTokens}`);
	}
} finally {
	await browser.close();
}
