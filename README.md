<h1 align="center">Open Browser</h1>

<p align="center">
  <b>AI-powered autonomous web browsing framework for TypeScript.</b>
</p>

<p align="center">
  <a href="https://github.com/ntegrals/openbrowser/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://www.npmjs.com/package/open-browser"><img src="https://img.shields.io/npm/v/open-browser.svg" alt="npm version"></a>
  <a href="https://github.com/ntegrals/openbrowser"><img src="https://img.shields.io/github/stars/ntegrals/openbrowser?style=social" alt="GitHub stars"></a>
</p>

---

Give an AI agent a browser. It clicks, types, navigates, and extracts data — autonomously completing tasks on any website. Built on Playwright with first-class support for OpenAI, Anthropic, and Google models.

> This project is under active development. APIs may change. Contributions welcome.

## Why Open Browser?

- **Autonomous agents**: Describe a task in natural language, and an AI agent navigates the web to complete it — clicking, typing, scrolling, and extracting data without manual scripting
- **Multi-model support**: Works with OpenAI, Anthropic, and Google out of the box via the Vercel AI SDK — swap models with a single flag
- **Interactive REPL**: Drop into a live browser session and issue commands interactively — great for debugging, prototyping, and exploration
- **Sandboxed execution**: Run agents in resource-limited environments with CPU/memory monitoring, timeouts, and domain restrictions
- **Production-ready**: Stall detection, cost tracking, session management, replay recording, and comprehensive error handling
- **Open source**: MIT licensed, fully extensible, bring your own API keys

## Quick Start

```bash
# Install dependencies
bun install

# Set up your API keys
cp .env.example .env
# Edit .env with your API keys

# Run an agent
bun run open-browser run "Find the top story on Hacker News and summarize it"

# Or open a browser interactively
bun run open-browser interactive
```

## Architecture

Open Browser is a monorepo with three packages:

| Package | Description |
|---|---|
| **`open-browser`** | Core library — agent logic, browser control, DOM analysis, LLM integration |
| **`@open-browser/cli`** | Command-line interface for running agents and browser commands |
| **`@open-browser/sandbox`** | Sandboxed execution with resource limits and monitoring |

## CLI Commands

### Run an AI Agent

```bash
open-browser run <task> [options]
```

Describe what you want done. The agent figures out the rest.

```bash
# Search and extract information
open-browser run "Find the price of the MacBook Pro on apple.com"

# Fill out forms
open-browser run "Sign up for the newsletter on example.com with test@email.com"

# Multi-step workflows
open-browser run "Go to GitHub, find the open-browser repo, and star it"
```

| Option | Description |
|---|---|
| `-m, --model <model>` | Model to use (default: `gpt-4o`) |
| `-p, --provider <provider>` | Provider: `openai`, `anthropic`, `google` |
| `--headless / --no-headless` | Show or hide the browser window |
| `--max-steps <n>` | Max agent steps (default: `25`) |
| `-v, --verbose` | Show detailed step info |
| `--no-cost` | Hide cost tracking |

### Browser Commands

```bash
open-browser open <url>              # Open a URL
open-browser click <selector>        # Click an element
open-browser type <selector> <text>  # Type into an input
open-browser screenshot [output]     # Capture a screenshot
open-browser eval <expression>       # Run JavaScript on the page
open-browser extract <goal>          # Extract content as markdown
open-browser state                   # Show current URL, title, and tabs
open-browser sessions                # List active browser sessions
```

### Interactive REPL

```bash
open-browser interactive
```

Drop into a live `browser>` prompt with full control:

```
browser> open https://news.ycombinator.com
browser> extract "top 5 stories with titles and points"
browser> click .morelink
browser> screenshot front-page.png
browser> help
```

## Using as a Library

```typescript
import { Agent, createViewport, createModel } from "open-browser";

const viewport = await createViewport({ headless: true });
const model = createModel("openai", "gpt-4o");

const agent = new Agent({
  viewport,
  model,
  task: "Go to example.com and extract the main heading",
  settings: {
    stepLimit: 50,
    enableScreenshots: true,
  },
});

const result = await agent.run();
console.log(result);
```

### Sandboxed Execution

Run agents with resource limits and monitoring:

```typescript
import { Sandbox } from "@open-browser/sandbox";

const sandbox = new Sandbox({
  timeout: 300_000,        // 5 minute timeout
  maxMemoryMB: 512,        // Memory limit
  allowedDomains: ["example.com"],
  stepLimit: 100,
  captureOutput: true,
});

const result = await sandbox.run({
  task: "Complete the checkout form",
  model: languageModel,
});

console.log(result.metrics); // steps, URLs visited, CPU time
```

## Configuration

### Environment Variables

```bash
# LLM Provider Keys (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...

# Browser
BROWSER_HEADLESS=true
BROWSER_DISABLE_SECURITY=false

# Recording & Debugging
OPEN_BROWSER_TRACE_PATH=./traces
OPEN_BROWSER_SAVE_RECORDING_PATH=./recordings
```

### Agent Configuration

| Setting | Default | Description |
|---|---|---|
| `stepLimit` | `100` | Maximum agent iterations |
| `commandsPerStep` | `10` | Actions per agent step |
| `failureThreshold` | `5` | Consecutive failures before stopping |
| `enableScreenshots` | `true` | Include page screenshots in agent context |
| `contextWindowSize` | `128000` | Token budget for conversation |
| `allowedUrls` | `[]` | Restrict navigation to specific URLs |
| `blockedUrls` | `[]` | Block navigation to specific URLs |

### Viewport Configuration

| Setting | Default | Description |
|---|---|---|
| `headless` | `true` | Run browser without visible window |
| `width` / `height` | `1280` / `1100` | Browser window dimensions |
| `relaxedSecurity` | `false` | Disable browser security features |
| `proxy` | — | Proxy server configuration |
| `cookieFile` | — | Path to cookie file for persistent sessions |

## How It Works

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

1. You describe a **task** in natural language
2. The **Agent** sends the current page state + task to an LLM
3. The LLM decides what **commands** to execute (click, type, navigate, extract...)
4. Commands execute against the **Viewport** (Playwright browser)
5. The agent observes the result, detects stalls, and loops until the task is complete

## Model Support

| Provider | Example Models | Flag |
|---|---|---|
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `o1` | `-p openai` |
| **Anthropic** | `claude-sonnet-4-5-20250929`, `claude-opus-4-6` | `-p anthropic` |
| **Google** | `gemini-2.0-flash`, `gemini-2.5-pro` | `-p google` |

## Project Structure

```
packages/
├── core/                    # Core library (open-browser)
│   └── src/
│       ├── agent/           # Agent logic, conversation, stall detection
│       ├── commands/        # Action schemas and executor (25+ commands)
│       ├── viewport/        # Browser control, events, guards
│       ├── page/            # DOM analysis, content extraction
│       ├── model/           # LLM adapter and message formatting
│       ├── metering/        # Cost tracking
│       ├── bridge/          # IPC server/client
│       └── config/          # Configuration types
├── cli/                     # CLI (@open-browser/cli)
│   └── src/
│       ├── commands/        # CLI command implementations
│       └── index.ts         # Entry point
└── sandbox/                 # Sandbox (@open-browser/sandbox)
    └── src/
        └── sandbox.ts       # Resource-limited execution
```

## Development

```bash
# Install dependencies
bun install

# Type check
bun run build

# Run tests
bun run test

# Lint
bun run lint

# Format
bun run format
```

## License

[MIT](LICENSE)
