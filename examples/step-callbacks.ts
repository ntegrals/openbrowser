/**
 * Step callbacks — monitor agent progress with onStepStart/onStepEnd hooks.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/step-callbacks.ts
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
		task: 'Go to https://example.com, click the "More information..." link, and tell me the page title',
		model,
		browser,
		settings: { stepLimit: 10 },
		onStepStart: (step) => {
			console.log(`\n--- Step ${step} starting ---`);
		},
		onStepEnd: (step, results) => {
			for (const result of results) {
				const status = result.success ? '✓' : '✗';
				const action = result.isDone ? 'done' : 'action';
				console.log(`  ${status} ${action}`);

				if (result.extractedContent) {
					console.log(`    extracted: ${result.extractedContent.slice(0, 100)}`);
				}
				if (result.error) {
					console.log(`    error: ${result.error}`);
				}
			}
		},
		onDone: (result) => {
			console.log(`\n=== Done (${result.success ? 'success' : 'failed'}) ===`);
		},
	});

	const result = await agent.run();
	console.log('Final result:', result.finalResult);
} finally {
	await browser.close();
}
