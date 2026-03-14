import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://news.ycombinator.com');

const cdp = await page.context().newCDPSession(page);
const result = await cdp.send('DOMSnapshot.captureSnapshot', {
  computedStyles: ['display', 'visibility'],
  includeDOMRects: true,
}) as any;

// Check top-level keys of result
console.log('Top-level keys:', Object.keys(result));
// Maybe strings is at top level, not inside documents
if (result.strings) {
  console.log('strings at top level, length:', result.strings.length);
  console.log('strings[4]:', result.strings[4]);
  console.log('strings[5]:', result.strings[5]);
}

await browser.close();
