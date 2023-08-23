# Open Browser

Browser automation toolkit with AI agent capabilities, built on [Playwright](https://playwright.dev/).

## Install

```bash
npm install open-browser
```

## Quick Start

```typescript
import { Viewport, Agent, OpenAIRawAdapter } from 'open-browser';

// Create a viewport
const viewport = new Viewport({ headless: true });
await viewport.launch();

// Set up an AI model
const model = new OpenAIRawAdapter({ model: 'gpt-4' });

// Run an agent
const agent = new Agent(model, { maxSteps: 50 });
const result = await agent.run({
  task: 'Go to example.com and extract the main heading',
});

console.log(result.output);
await viewport.close();
```

## Features

- **AI agent loop** — give the agent a task and it figures out the clicks, typing, and navigation
- **OpenAI integration** — uses GPT-4 via the OpenAI API to power agent decisions
- **Playwright-based** — supports Chromium, Firefox, and WebKit
- Built-in commands: click, type, navigate, scroll, screenshot, evaluate, extract
- DOM inspection and interactive element detection
- Guard system for handling popups, crashes, and URL policies
- Stall detection to prevent infinite loops
- Conversation management with automatic pruning
- Full TypeScript support

## Agent

The `Agent` class runs an autonomous loop:

1. Observes the current page state
2. Sends it to an LLM with the task description
3. The LLM decides what action to take
4. The action is executed in the browser
5. Repeat until the task is complete or the step limit is reached

```typescript
const model = new OpenAIRawAdapter({ model: 'gpt-4' });
const agent = new Agent(model, {
  maxSteps: 100,
  systemPrompt: 'You are a helpful browser assistant.',
});

const result = await agent.run({
  task: 'Find the top story on Hacker News',
});

console.log(result.output);
console.log(`Completed in ${result.totalSteps} steps`);
```

## Configuration

```bash
# .env
OPENAI_API_KEY=sk-...
BROWSER_HEADLESS=true
```

## License

MIT
