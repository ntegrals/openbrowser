# open-browser

Programmable browser automation toolkit for Node.js, built on [Playwright](https://playwright.dev/).

## Install

```bash
bun add open-browser
```

## Quick Start

```typescript
import { Viewport } from 'open-browser';

const viewport = new Viewport({ headless: true });
await viewport.launch();
await viewport.navigate('https://example.com');
await viewport.click('button.submit');
await viewport.close();
```

## Features

- **Playwright-based** — supports Chromium, Firefox, and WebKit
- Built-in commands: click, type, navigate, scroll, screenshot, evaluate
- DOM inspection and interactive element detection
- Content extraction (text, links, metadata)
- Guard system for handling popups, crashes, blank pages, and URL policies
- Typed event emitter
- Full TypeScript support

## API

### Viewport

The main class for controlling a browser instance.

```typescript
const viewport = new Viewport({
  headless: true,
  viewport: { width: 1920, height: 1080 },
  navigationTimeout: 30000,
});
```

### DomInspector

Inspect and query page elements.

```typescript
const elements = await viewport.inspector.getInteractiveElements();
const tree = await viewport.inspector.getPageTree();
```

### Guards

Automatic handlers for browser events:

- `BlankPageGuard` — detects blank/empty pages
- `CrashGuard` — monitors for page crashes
- `PopupGuard` — auto-dismisses dialogs
- `UrlPolicyGuard` — enforces URL allowlist/blocklist

### EventHub

Listen for browser events.

```typescript
viewport.events.on('navigated', ({ url }) => {
  console.log('Navigated to:', url);
});
```

## License

MIT
