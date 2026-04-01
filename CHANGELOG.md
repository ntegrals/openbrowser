# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Experimental MCP (Model Context Protocol) server support
- TypeScript 5.8 support

### Fixed
- Handle CDP protocol changes in latest Chromium
- Biome ignore patterns for generated files

## [1.1.0] - 2025-12-01

### Added
- `viewport.pdf()` — export pages as PDF
- Custom user-agent support in launch profile
- AI SDK updated to 4.2 with improved model support

### Fixed
- Instruction builder template variable escaping

### Changed
- Updated Biome to 1.9.4
- Security patches for dependencies

## [1.0.1] - 2025-10-07

### Fixed
- Agent step counter off-by-one error
- Schema optimizer stripping required fields
- Content extractor encoding for CJK pages
- Viewport crash on rapid navigation sequences
- Agent retry logic on model timeout

### Added
- `--timeout` flag for CLI `run` command
- GitHub Actions CI workflow
- Contributing guidelines

### Changed
- Improved sandbox process isolation
- Improved CLI help text and examples
- Reduced snapshot builder memory allocations
- Updated Playwright to 1.50
- Updated TypeScript to 5.7

## [1.0.0] - 2025-04-25

### Added
- **Core library** (`open-browser`) — AI-powered autonomous web browsing for TypeScript
- **Agent system** with multi-model support (OpenAI, Anthropic, Google via Vercel AI SDK)
- **25+ browser commands**: tap, type, scroll, navigate, extract, capture, web search, and more
- **Stall detection** with escalating recovery nudges
- **Conversation compaction** for long-running agent sessions
- **Cost tracking** across multiple models with per-step breakdowns
- **Result evaluation** via judge model
- **Replay recording** in GIF format
- **Visual tracer** for debugging agent runs
- **13 viewport guards**: crash recovery, popup blocking, download control, URL policies, page-ready detection, and more
- **Structured extraction** with Zod schema validation
- **Markdown extraction** from web pages via Turndown
- **CLI** (`@open-browser/cli`) with commands: `run`, `open`, `click`, `type`, `screenshot`, `extract`, `eval`, `sessions`, `interactive`
- **Sandbox** (`@open-browser/sandbox`) — resource-limited execution environment
- **Schema optimizer** for LLM-friendly JSON Schema output (union collapsing, enum simplification, provider-specific tweaks)
- **Extended thinking** support with configurable reasoning budgets
- **Compact/flash mode** for lighter models
- **URL allow/block lists** for security policies
- **Tab management** — multi-tab browsing with focus, open, close

[Unreleased]: https://github.com/ntegrals/openbrowser/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/ntegrals/openbrowser/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/ntegrals/openbrowser/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ntegrals/openbrowser/releases/tag/v1.0.0
