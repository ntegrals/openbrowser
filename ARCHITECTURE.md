# Architecture

This document describes the internal architecture of the Open Browser monorepo.

## Repository Structure

```
open-browser/
├── packages/
│   ├── core/          # Main library (open-browser)
│   ├── cli/           # Command-line interface (@open-browser/cli)
│   └── sandbox/       # Sandboxed execution (@open-browser/sandbox)
├── .github/workflows/ # CI and publish pipelines
└── biome.json         # Linter and formatter config
```

## High-Level Data Flow

```
User Task (string)
      │
      ▼
┌──────────┐    system prompt    ┌────────────────────┐
│  Agent   │ ──────────────────► │  InstructionBuilder │
│          │                     └────────────────────┘
│          │    DOM tree + screenshot
│          │ ◄── PageAnalyzer ◄── Viewport (Playwright)
│          │
│          │    messages
│          │ ──► ConversationManager ──► LLM (LanguageModel)
│          │                             │
│          │    AgentDecision            │
│          │ ◄──────────────────────────┘
│          │
│          │    actions[]
│          │ ──► CommandExecutor ──► Viewport
│          │                         │
│          │    CommandResult[]       │
│          │ ◄──────────────────────┘
│          │
│          │    check loops
│          │ ──► StallDetector
└──────────┘
      │
      ▼
  RunOutcome (success, finalResult, cost)
```

## Core Package Modules

### Agent (`agent/agent.ts`)

The central orchestrator. Runs a step loop that:

1. Captures browser state (URL, title, tabs) via `Viewport`
2. Extracts DOM into a serialized tree via `PageAnalyzer`
3. Takes a screenshot (optional)
4. Builds a state message and adds it to conversation history
5. Checks the `StallDetector` for loop warnings
6. Invokes the LLM with a Zod-validated response schema
7. Executes returned actions via `CommandExecutor`
8. Records step in `ExecutionLog`, updates cost tracking

The agent adapts its output schema based on the model:
- **Standard mode** — full reasoning + actions
- **Compact mode** — simplified schema for flash/smaller models
- **Extended thinking** — reasoning delegated to model internals

On Zod validation failure, the agent re-prompts the LLM with the validation error for self-correction.

### Commands (`commands/`)

**CommandCatalog** — a registry of named actions with Zod schemas and handler functions. Built-in actions include:

| Category | Actions |
|---|---|
| Navigation | `navigate`, `back`, `web_search`, `search`, `new_tab`, `focus_tab`, `close_tab` |
| Interaction | `tap`, `type_text`, `scroll`, `scroll_to`, `press_keys`, `select`, `pick_option`, `upload` |
| Extraction | `extract`, `extract_structured`, `read_page`, `find`, `list_options` |
| Control | `capture`, `wait`, `finish` |

**CommandExecutor** — dispatches actions to handlers, injecting an `ExecutionContext` that provides access to the Playwright `Page`, CDP session, `PageAnalyzer`, `Viewport`, and optional services (extraction LLM, file system, masked values).

Handler parameters are auto-detected by inspecting the function signature — handlers only receive the services they declare.

Errors are classified into categories (network, element not found, timeout, crash) with actionable recovery suggestions returned to the agent.

### Viewport (`viewport/viewport.ts`)

Manages the Playwright browser lifecycle:

- **Launch/connect** — local browser or remote WebSocket/CDP
- **Page management** — navigate, screenshot, tab switching
- **CDP integration** — direct Chrome DevTools Protocol access
- **Event bus** — emits lifecycle events (`page-ready`, `crash`, `shutdown`, etc.)
- **Reconnection** — auto-reconnect with exponential backoff on disconnect

**Guard System** — a collection of watchdogs that intercept browser events:

| Guard | Purpose |
|---|---|
| `UrlPolicyGuard` | Enforce allowed/blocked URL lists |
| `PageReadyGuard` | Detect page load completion |
| `PopupGuard` | Auto-dismiss popups and dialogs |
| `DownloadGuard` | Intercept and manage downloads |
| `CrashGuard` | Detect and report browser crashes |
| `ScreenshotGuard` | Handle screenshot capture |
| `PersistenceGuard` | Save/restore session state |
| `BlankPageGuard` | Handle blank/new tab pages |
| `DefaultHandlerGuard` | Default permission handlers |
| `LocalInstanceGuard` | Ensure local browser only |

Guards extend `BaseGuard` and are initialized during `Viewport.start()`.

### Page Analyzer (`page/page-analyzer.ts`)

Converts a live Playwright page into a structured representation for the LLM:

1. Captures DOM via CDP snapshots (structure + accessibility tree + layout)
2. Merges into a unified tree, computing element visibility
3. Filters elements outside the viewport threshold
4. Integrates shadow DOM children into the main tree
5. Assigns numeric indices to interactive elements
6. Serializes to a compact HTML-like string with key attributes

Returns a `RenderedPageState` with the tree string, element count, scroll position, and viewport dimensions. The analyzer caches its output and maintains an element-to-CSS-selector map for click/input targeting.

### Stall Detector (`agent/stall-detector.ts`)

Detects when the agent is stuck in a loop by tracking:

- **Repeated actions** — same action 3+ times consecutively
- **Action cycles** — A→B→A→B or A→B→C→A→B→C patterns
- **Page fingerprints** — same DOM hash + scroll position repeated
- **Stagnant pages** — same URL + element count for 5+ steps

Severity escalates with repetition count:

| Repetitions | Severity | Agent receives |
|---|---|---|
| < 5 | 0 | Nothing |
| 5–7 | 1 | "Try a different approach" |
| 8–11 | 2 | "Use a fundamentally different strategy" |
| 12+ | 3 | "Must change approach or report failure" |

Actions are normalized (ignoring parameter variations) and search terms are sorted for order-independent matching.

### Conversation Manager (`agent/conversation/service.ts`)

Manages the LLM message history:

- **Message tracking** — each message carries token estimates, step number, and category
- **Compaction** — when context grows too large, older messages are summarized via an LLM call
- **Ephemeral messages** — one-shot instructions (e.g., replan prompts) that auto-remove after one `getMessages()` call
- **Sensitive data masking** — applied at retrieval time, replacing values with `[MASKED:key]` tokens
- **Serialization** — conversation can be saved to file for debugging

### Model Adapter (`model/`)

**`LanguageModel`** — the interface all LLM providers implement:

```typescript
interface LanguageModel {
  modelId: string;
  provider: ModelProvider;
  invoke<T>(options: InferenceOptions<T>): Promise<InferenceResult<T>>;
}
```

**`VercelModelAdapter`** — wraps any Vercel AI SDK model (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) into the `LanguageModel` interface. Handles structured output via `generateObject()`, rate-limit detection, and provider inference.

**`SchemaOptimizer`** — optimizes Zod/JSON schemas for LLM consumption: collapses large unions, simplifies enums, flattens deep nesting, and applies provider-specific tweaks (e.g., Gemini requires descriptions on all properties).

### Bridge (`bridge/`)

Exposes browser commands as an MCP (Model Context Protocol) server:

- **`BridgeAdapter`** — converts `CommandCatalog` entries to MCP tool definitions (prefixed `browser_*`)
- **`BridgeServer`** — JSON-RPC server handling MCP requests/responses
- **`BridgeClient`** — client for connecting to a running bridge

### Metering (`metering/tracker.ts`)

Tracks token usage and cost:

- **`UsageMeter`** — per-model token counting and cost estimation
- **`CompositeUsageMeter`** — aggregates across multiple models (agent + extraction + planner)
- **Budget enforcement** — throws `BudgetDepletedError` when policy limits are exceeded

### File Access (`sandbox/file-access.ts`)

Secure file system access for agent commands:

- Restricts operations to a sandbox directory
- Whitelists file extensions (`.txt`, `.md`, `.json`, `.csv`, etc.)
- Enforces max file size (10MB default)
- Optional read-only mode

## CLI Package

Commander.js-based CLI with commands: `run`, `open`, `click`, `type`, `screenshot`, `extract`, `eval`, `sessions`, `interactive`.

The `run` command creates an `Agent` with the specified model/provider, displays step progress with a spinner, and shows a cost summary on completion.

## Sandbox Package

Resource-limited execution environment that wraps `Agent.run()` with monitoring for CPU, memory, and timeout constraints.

## Cross-Cutting Patterns

**Event-driven lifecycle** — `Viewport.eventBus` emits events consumed by guards and the agent.

**Zod everywhere** — command schemas, agent output schemas, config validation, and LLM structured output all use Zod.

**Error classification** — browser errors are categorized with recovery suggestions, not just re-thrown.

**Sensitive data masking** — masked values flow through conversation, command results, and final output.

**Pluggable models** — any Vercel AI SDK model works via `VercelModelAdapter`; custom adapters implement `LanguageModel`.
