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

function htmlTableToMarkdown(table: HTMLTableElement): string {
	const rows: string[][] = [];
	const tableRows = table.querySelectorAll('tr');

	for (const row of tableRows) {
		const cells: string[] = [];
		for (const cell of row.querySelectorAll('th, td')) {
			cells.push((cell.textContent ?? '').trim().replace(/\|/g, '\\|'));
		}
		if (cells.length > 0) {
			rows.push(cells);
		}
	}

	if (rows.length === 0) return '';

	const maxCols = Math.max(...rows.map((r) => r.length));

	// Pad rows to same column count
	for (const row of rows) {
		while (row.length < maxCols) {
			row.push('');
		}
	}

	const lines: string[] = [];
	// Header
	lines.push(`| ${rows[0].join(' | ')} |`);
	lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`);

	// Body
	for (let i = 1; i < rows.length; i++) {
		lines.push(`| ${rows[i].join(' | ')} |`);
	}

	return '\n' + lines.join('\n') + '\n';
}

/**
 * Known programming language names used as a fallback for bare class name matching.
 */
const KNOWN_LANGUAGES = new Set([
	'javascript', 'typescript', 'python', 'ruby', 'java', 'go', 'rust', 'c',
	'cpp', 'csharp', 'swift', 'kotlin', 'scala', 'php', 'perl', 'lua',
