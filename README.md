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

## License

MIT
