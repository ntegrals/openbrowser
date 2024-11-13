# Open Browser

AI-powered autonomous web browsing framework for TypeScript.

Give an AI agent a browser. It clicks, types, navigates, and extracts data — autonomously completing tasks on any website. Built on Playwright with support for OpenAI, Anthropic, and Google models via the Vercel AI SDK.

## Quick Start

```bash
npm install open-browser
```

```typescript
import { Agent, Viewport, VercelModelAdapter } from 'open-browser';
import { openai } from '@ai-sdk/openai';

const viewport = new Viewport({ headless: false });
await viewport.launch();

const model = new VercelModelAdapter(openai('gpt-4o'));
const agent = new Agent(model, { maxSteps: 50 });

const result = await agent.run({
  task: 'Find the price of the MacBook Pro on apple.com',
});

console.log(result.output);
await viewport.close();
```

## Features

- **Autonomous AI agents** — describe a task, the agent navigates the web to complete it
- **Multi-model support** — OpenAI, Anthropic, Google via Vercel AI SDK
- **Production-ready** — stall detection, cost tracking, session management, error recovery
- **Guard system** — handles popups, crashes, downloads, URL policies, blank pages
- **Bridge architecture** — IPC server/client for inter-process browser control
- **Visual tracer** — debug mode with visual overlays showing agent actions
- **Replay recording** — record and replay browser sessions
- **Content extraction** — extract structured data or markdown from any page

## Architecture

```
                    ┌─────────────┐
  "Book a flight"   │             │
  ───────────────►  │    Agent    │  ◄── LLM (OpenAI / Anthropic / Google)
                    │             │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Commands  │  click, type, scroll, extract, navigate...
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Viewport   │  Playwright browser instance
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  DOM / Page │  Snapshot, interactive elements, content
                    └─────────────┘
```

## Model Support

| Provider | Models | Package |
|---|---|---|
| **OpenAI** | gpt-4o, gpt-4o-mini | `@ai-sdk/openai` |
| **Anthropic** | claude-3.5-sonnet, claude-3-opus | `@ai-sdk/anthropic` |
| **Google** | gemini-1.5-pro, gemini-1.5-flash | `@ai-sdk/google` |

## Configuration

```bash
# LLM Provider Keys (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...

# Browser
BROWSER_HEADLESS=true
BROWSER_DISABLE_SECURITY=false
```

## License

MIT
