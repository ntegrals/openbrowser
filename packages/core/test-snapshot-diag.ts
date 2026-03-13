import { chromium } from 'playwright';
import { SnapshotBuilder } from './src/page/snapshot-builder.js';

async function main() {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	const page = await context.newPage();
	const cdpSession = await context.newCDPSession(page);

	await page.goto('https://news.ycombinator.com', { waitUntil: 'networkidle' });

	const builder = new SnapshotBuilder();
	const { domSnapshot, axTree } = await builder.captureSnapshot(cdpSession);

	console.log('=== Snapshot captured ===');
	console.log('Documents:', domSnapshot.documents.length);
	console.log('Top-level strings:', domSnapshot.strings?.length ?? 'N/A');

	const { root, indexCounter } = builder.buildTree(
		domSnapshot,
		axTree,
		{ width: 1280, height: 720 },
		['title', 'type', 'name', 'role', 'tabindex', 'aria-label', 'placeholder', 'value', 'alt', 'aria-expanded'],
	);

	console.log('\n=== Tree built ===');
	console.log('Index counter (interactive elements):', indexCounter);
	console.log('Root tag:', root.tagName);
	console.log('Root children:', root.children.length);

	// Count total nodes and interactive nodes
	let totalNodes = 0;
	let interactiveNodes = 0;
	let visibleNodes = 0;
	const interactiveExamples: { index: number; tag: string; text?: string; ariaLabel?: string }[] = [];

	function walk(node: typeof root) {
		totalNodes++;
		if (node.isVisible) visibleNodes++;
		if (node.highlightIndex !== undefined) {
			interactiveNodes++;
			if (interactiveExamples.length < 10) {
				interactiveExamples.push({
					index: node.highlightIndex as number,
					tag: node.tagName,
					text: node.text?.slice(0, 60),
					ariaLabel: node.ariaLabel?.slice(0, 60),
				});
			}
		}
		for (const child of node.children) {
			walk(child);
		}
	}

	walk(root);

	console.log('Total nodes in tree:', totalNodes);
	console.log('Visible nodes:', visibleNodes);
	console.log('Interactive nodes:', interactiveNodes);

	console.log('\n=== First 10 interactive elements ===');
	for (const ex of interactiveExamples) {
		console.log(`  [${ex.index}] <${ex.tag}> text="${ex.text ?? ''}" aria="${ex.ariaLabel ?? ''}" `);
	}

	await browser.close();
	console.log('\nDone!');
}

main().catch(console.error);
