import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://news.ycombinator.com');

const cdp = await page.context().newCDPSession(page);
const result = await cdp.send('DOMSnapshot.captureSnapshot', {
  computedStyles: ['display', 'visibility'],
  includeDOMRects: true,
  includePaintOrder: true,
}) as any;

const doc = result.documents?.[0];
console.log('Has documents:', !!result.documents, result.documents?.length);
console.log('Doc keys:', doc ? Object.keys(doc) : 'no doc');
console.log('Has strings:', !!doc?.strings, 'length:', doc?.strings?.length);
console.log('Has nodes:', !!doc?.nodes);
console.log('nodes keys:', doc?.nodes ? Object.keys(doc.nodes) : 'none');

await browser.close();
