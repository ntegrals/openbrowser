/**
 * URL security policies — restrict which URLs the agent can navigate to.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/url-security.ts
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { Agent, Viewport, VercelModelAdapter } from 'open-browser';

const anthropic = createAnthropic({});
const model = new VercelModelAdapter({
	model: anthropic('claude-haiku-4-5-20251001'),
});

// Allow only specific domains
const browser = new Viewport({
	headless: true,
	allowedUrls: ['https://example.com/*', 'https://*.iana.org/*'],
});
await browser.start();

try {
	const agent = new Agent({
		task: 'Go to https://example.com and tell me what you see',
		model,
		browser,
		settings: { stepLimit: 5 },
	});

	const result = await agent.run();
	console.log('Result:', result.finalResult);

	// The agent cannot navigate outside the allowed domains.
	// If it tries, the UrlPolicyGuard will block the navigation.
} finally {
	await browser.close();
}
