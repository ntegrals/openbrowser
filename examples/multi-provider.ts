/**
 * Multi-provider example — use different LLM providers (OpenAI, Anthropic, Google).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... bun run examples/multi-provider.ts openai
 *   ANTHROPIC_API_KEY=sk-... bun run examples/multi-provider.ts anthropic
 *   GOOGLE_GENERATIVE_AI_API_KEY=... bun run examples/multi-provider.ts google
 */
import { Agent, Viewport, VercelModelAdapter, type LanguageModel } from 'open-browser';

const provider = process.argv[2] ?? 'anthropic';

async function createModel(provider: string): Promise<LanguageModel> {
	switch (provider) {
		case 'openai': {
			const { createOpenAI } = await import('@ai-sdk/openai');
			const openai = createOpenAI({});
			return new VercelModelAdapter({ model: openai('gpt-4o-mini') });
		}
		case 'anthropic': {
			const { createAnthropic } = await import('@ai-sdk/anthropic');
			const anthropic = createAnthropic({});
			return new VercelModelAdapter({ model: anthropic('claude-haiku-4-5-20251001') });
		}
		case 'google': {
			const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
			const google = createGoogleGenerativeAI({});
			return new VercelModelAdapter({ model: google('gemini-2.0-flash') });
		}
		default:
			throw new Error(`Unknown provider: ${provider}. Use: openai, anthropic, google`);
	}
}

const model = await createModel(provider);
const browser = new Viewport({ headless: true });
await browser.start();

try {
	console.log(`Using provider: ${provider} (${model.modelId})`);

	const agent = new Agent({
		task: 'Go to https://example.com and tell me the main heading text',
		model,
		browser,
		settings: { stepLimit: 5 },
	});

	const result = await agent.run();
	console.log('Result:', result.finalResult);
} finally {
	await browser.close();
}
