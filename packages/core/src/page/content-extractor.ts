import TurndownService from 'turndown';
import type { Page } from 'playwright';

let turndownInstance: TurndownService | null = null;

function getTurndown(): TurndownService {
	if (!turndownInstance) {
		turndownInstance = new TurndownService({
			headingStyle: 'atx',
			codeBlockStyle: 'fenced',
			emDelimiter: '*',
		});

		// Remove scripts, styles, and other non-content elements
		turndownInstance.remove(['script', 'style', 'nav', 'footer', 'header', 'noscript']);

		// Preserve tables as markdown tables
		turndownInstance.addRule('table', {
			filter: 'table',
			replacement: (_content, node) => {
				const table = node as HTMLTableElement;
				return htmlTableToMarkdown(table);
			},
		});

		// Preserve code blocks with enhanced language detection from class attributes.
		// Supports patterns: language-xxx, lang-xxx, highlight-xxx, brush:xxx, and bare lang names.
		turndownInstance.addRule('codeBlock', {
			filter: (node) => {
				return (
					node.nodeName === 'PRE' &&
					node.firstChild !== null &&
					node.firstChild.nodeName === 'CODE'
				);
			},
			replacement: (_content, node) => {
				const codeEl = node.firstChild as HTMLElement;
				const lang = detectCodeLanguage(codeEl);
				const code = codeEl?.textContent ?? '';
				return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
			},
		});
	}
	return turndownInstance;
}
