import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://news.ycombinator.com');

const cdp = await page.context().newCDPSession(page);
const result = await cdp.send('DOMSnapshot.captureSnapshot', {
  computedStyles: ['display', 'visibility'],
  includeDOMRects: true,
}) as any;

const doc = result.documents?.[0];
// Check types of nodeName values
console.log('nodeName[0]:', doc.nodes.nodeName[0], typeof doc.nodes.nodeName[0]);
console.log('nodeName[1]:', doc.nodes.nodeName[1], typeof doc.nodes.nodeName[1]);
console.log('nodeValue[0]:', doc.nodes.nodeValue[0], typeof doc.nodes.nodeValue[0]);
console.log('layout.text[0]:', doc.layout.text[0], typeof doc.layout.text[0]);

await browser.close();
