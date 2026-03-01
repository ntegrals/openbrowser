# Test Coverage Analysis

## Current State

The project has **10 test files** covering **10 out of ~100 source files** (10% file-level coverage).
The existing 111 tests with 208 assertions pass (excluding dependency-install failures).

### What IS tested today

| Module | Test File | Source LOC | What's Covered |
|--------|-----------|-----------|----------------|
| Agent | `agent.test.ts` | 1,017 | Core execution loop, mock LLM decision flow |
| Conversation | `conversation.test.ts` | 578 | Message management, context windows, token estimation |
| Stall Detector | `stall-detector.test.ts` | 374 | Page signature hashing, loop detection |
| Command Executor | `executor.test.ts` | 1,078 | Command dispatch, error handling, viewport interaction |
| Command Catalog | `catalog.test.ts` | 393 | Command registration, parameter validation, schema checks |
| Page Analyzer | `page-analyzer.test.ts` | 554 | DOM tree building, element indexing |
| Tree Renderer | `renderer.test.ts` | 572 | Tree serialization, element visibility |
| Metering Tracker | `tracker.test.ts` | 428 | Token counting, cost calculation |
| Bridge Server | `server.test.ts` | 651 | IPC communication |
| Launch Profile | `launch-profile.test.ts` | 258 | Browser launch configuration, builder pattern |

---

## Recommended Improvements — Prioritized

### Tier 1: Critical (high complexity, zero tests, core functionality)

#### 1. `utils.ts` — Core utility functions (246 LOC)

**Why:** Used everywhere. Contains URL matching with regex, retry logic with exponential backoff, text sanitization, and deadline enforcement. Bugs here silently break the whole system. These are also pure functions — easy to test.

**What to test:**
- `matchesUrlPattern()` — wildcard domains (`*.example.com`), path matching (`/api/*`), protocol handling, invalid URLs
- `isUrlPermitted()` — interaction between allowlists and blocklists, empty lists, overlapping rules
- `matchUrlWithDomainPattern()` — www normalization, port stripping, wildcard subdomains
- `withRetry()` — retry count, backoff timing, error propagation after exhaustion
- `withDeadline()` — timeout behavior, successful completion before deadline
- `sanitizeText()` — control character removal, whitespace normalization
- `truncateText()` — boundary conditions (exact length, shorter than suffix)
- `chunkText()` — paragraph boundary splitting, sentence-level splitting for oversized paragraphs
- `dedent()` — mixed indentation, empty lines, single-line input
- `extractUrls()` — various URL formats, edge cases with special characters
- `sanitizeSurrogates()` — unpaired surrogates replaced with U+FFFD

**Estimated effort:** Low — all pure functions, no mocks needed.

---

#### 2. `model/schema-optimizer.ts` — LLM schema optimization (475 LOC)

**Why:** Directly affects how the LLM interprets the command schema. A bug here can make the agent produce malformed commands or miss valid actions. Complex recursive tree-walking logic that is hard to verify by inspection.

**What to test:**
- `optimizeJsonSchemaForModel()` — end-to-end with a realistic command schema
- `collapseUnions()` — oneOf/anyOf with variants exceeding the threshold, variants below the threshold unchanged
- `collapseEnums()` — case-insensitive deduplication, truncation with annotation
- `flattenNesting()` — objects nested beyond maxDepth get dot-separated keys, shallow objects unchanged
- `applyProviderTweaks()` — Gemini: all properties get descriptions; OpenAI: additionalProperties removed, required lists auto-populated
- `walkSchema()` — traverses properties, array items, combiners (oneOf/anyOf/allOf), additionalProperties
- `zodToJsonSchema()` — object, string, number, boolean, array, enum, literal, union, discriminated union, nullable, record, optional, default
- `humanizePropertyName()` — camelCase and snake_case conversion

**Estimated effort:** Low-Medium — pure functions, but need representative schema fixtures.

---

#### 3. `viewport/event-hub.ts` — Event bus (114 LOC)

**Why:** Foundation of the viewport event system. Used by all guards and the agent. Small file but the request/response pattern with timeouts has subtle edge cases.

**What to test:**
- `on()` / `emit()` — basic pub-sub, multiple handlers, handler errors don't break other handlers
- `once()` — fires only once then auto-removes
- `off()` — remove specific handler vs. remove all handlers for an event
- `request()` / `onRequest()` — successful request-response, timeout behavior, no handler registered error
- `getHistory()` — records events, filters by event name, respects maxHistory cap
- `removeAllListeners()` — clears both event and request handlers

**Estimated effort:** Low — standalone class, no external dependencies.

---

#### 4. `page/content-extractor.ts` — HTML-to-markdown & text extraction (378 LOC)

**Why:** The agent reads pages through this module. If markdown extraction is wrong, the agent misunderstands page content. Contains regex-based language detection and text chunking logic.

**What to test:**
- `htmlToMarkdown()` — headings, lists, links, code blocks, tables, scripts/styles removed
- `detectCodeLanguage()` (internal but testable via htmlToMarkdown) — `language-xxx`, `lang-xxx`, `highlight-xxx`, `brush:xxx`, data-lang attribute, bare known language class
- `htmlTableToMarkdown()` — simple table, irregular column counts, escaped pipe characters
- `ReadingState` — offset tracking, URL change resets offset, progress calculation, advance clamping
- `chunkText()` — single paragraph fits, paragraph boundary splitting, sentence splitting for oversized paragraphs, empty input

**Estimated effort:** Low-Medium — `htmlToMarkdown` needs HTML string fixtures but no browser. `extractMarkdown`/`extractLinks`/`extractTextContent` need a Playwright Page mock.

---

#### 5. `agent/evaluator.ts` — Task completion evaluation (244 LOC)

**Why:** Determines whether a task succeeded. False positives waste user time; false negatives cause unnecessary retries. Currently zero tests.

**What to test:**
- `evaluate()` — passes correct context (history, screenshots) to LLM, parses LLM response
- `simpleEvaluate()` — lightweight validation against task goal
- `compareWithExpected()` — ground truth comparison logic

**Estimated effort:** Medium — requires mocking the LLM adapter.

---

#### 6. `agent/instructions.ts` — System prompt construction (562 LOC)

**Why:** Controls the agent's behavior via system prompts. Changes here affect every task. Snapshot tests would catch unintended prompt drift.

**What to test:**
- `buildSystemPrompt()` — includes command catalog, URL policies, and configuration context
- Prompt variations based on config (e.g., enabled/disabled commands, allowed URLs)
- Snapshot tests to detect prompt regression

**Estimated effort:** Low — string construction, snapshot-friendly.

---

### Tier 2: High Priority (significant gaps in important modules)

#### 7. `page/snapshot-builder.ts` (247 LOC)
- Tree construction from CDP snapshots
- AX tree mapping
- Would need mock CDP session data as fixtures

#### 8. `commands/extraction/extractor.ts` (207 LOC)
- Content extraction with LLM
- Structured extraction with Zod schema validation
- Chunked extraction and result aggregation

#### 9. `model/adapters/vercel.ts` (175 LOC)
- LLM invocation with structured output
- Message format conversion
- Error handling for API failures

#### 10. `agent/replay-recorder.ts` (282 LOC)
- Action recording
- Replay script generation
- Should be straightforward to unit test

#### 11. `bridge/client.ts` (480 LOC)
- Client-side IPC communication (server side already tested)

#### 12. Viewport guards — the most critical ones:
- `page-ready.ts` (337 LOC) — page readiness detection
- `downloads.ts` (291 LOC) — download interception
- `url-policy.ts` (49 LOC) — URL allowlist/blocklist enforcement (small, high-value)

---

### Tier 3: Medium Priority

#### 13. `config/config.ts` (167 LOC)
- Singleton access, file loading/saving, environment detection

#### 14. `sandbox/sandbox.ts` (484 LOC)
- Resource monitoring, output capture, timeout/OOM handling

#### 15. `errors.ts` (163 LOC)
- Error hierarchy — low complexity but snapshot tests ensure error names/messages don't regress

#### 16. CLI package — 0% coverage (1,200+ LOC across 16 files)
- `commands/interactive.ts` (341 LOC) and `commands/run.ts` (225 LOC) are the highest-value targets
- `server.ts` (186 LOC) and `display.ts` (168 LOC) next

---

## Summary

| Tier | Files | Combined LOC | Effort | Impact |
|------|-------|-------------|--------|--------|
| **Tier 1** (Critical) | 6 files | ~2,019 | Low-Medium | Covers core logic used on every run |
| **Tier 2** (High) | 7 files | ~1,868 | Medium | Fills gaps in agent, commands, model layers |
| **Tier 3** (Medium) | 5+ files | ~2,000+ | Medium-High | Config, sandbox, CLI, error classes |

**Recommended starting point:** `utils.ts`, `schema-optimizer.ts`, and `event-hub.ts` — they are pure functions or standalone classes with no external dependencies, making them fast to write and high-confidence.
