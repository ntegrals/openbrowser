# open-browser

Programmable browser automation toolkit for Node.js.

## Install

```bash
npm install open-browser
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

- Puppeteer-based browser automation
- Typed event system
- DOM inspection and element detection
- Built-in commands: click, type, navigate, scroll, screenshot
- Configurable viewport and timeouts

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

### EventHub

Listen for browser events.

```typescript
viewport.events.on('navigated', ({ url }) => {
  console.log('Navigated to:', url);
});
```

## License

MIT
