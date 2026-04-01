# Examples

Runnable examples demonstrating Open Browser's capabilities.

## Prerequisites

```bash
bun install
```

Set at least one API key:

```bash
export ANTHROPIC_API_KEY=sk-...
# or
export OPENAI_API_KEY=sk-...
# or
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

## Examples

| Example | Description |
|---|---|
| [basic-agent.ts](./basic-agent.ts) | Give a task in natural language, get a result |
| [extract-data.ts](./extract-data.ts) | Extract structured data from a web page |
| [multi-provider.ts](./multi-provider.ts) | Switch between OpenAI, Anthropic, and Google models |
| [step-callbacks.ts](./step-callbacks.ts) | Monitor agent progress with `onStepStart`/`onStepEnd` hooks |
| [headless-vs-visible.ts](./headless-vs-visible.ts) | Run with or without a visible browser window |
| [url-security.ts](./url-security.ts) | Restrict which URLs the agent can visit |

## Running

```bash
bun run examples/basic-agent.ts
bun run examples/multi-provider.ts openai
bun run examples/headless-vs-visible.ts visible
```
