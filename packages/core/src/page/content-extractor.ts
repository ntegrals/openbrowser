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
	'bash', 'shell', 'sh', 'zsh', 'powershell', 'sql', 'html', 'css',
	'scss', 'less', 'json', 'yaml', 'yml', 'xml', 'toml', 'ini',
	'markdown', 'md', 'jsx', 'tsx', 'graphql', 'r', 'matlab', 'dart',
	'elixir', 'erlang', 'haskell', 'ocaml', 'clojure', 'vim', 'dockerfile',
	'makefile', 'cmake', 'protobuf', 'terraform', 'hcl',
]);

/**
 * Detect the programming language from a code element's class attribute.
 * Tries multiple patterns commonly used by syntax highlighters:
 * - language-xxx (Prism, highlight.js)
 * - lang-xxx (some highlighters)
 * - highlight-xxx / hljs xxx
 * - brush: xxx (SyntaxHighlighter)
 * - data-lang attribute
 * - bare class name matching a known language
 */
function detectCodeLanguage(codeEl: HTMLElement | null): string {
	if (!codeEl) return '';

	// Check data-lang attribute first (used by some markdown renderers)
	const dataLang = codeEl.getAttribute?.('data-lang') ?? '';
	if (dataLang) return dataLang.toLowerCase();

	const className = codeEl.getAttribute?.('class') ?? '';
	if (!className) return '';

	// Pattern: language-xxx or lang-xxx
	const langPrefixMatch = className.match(/(?:language|lang)-(\w+)/);
	if (langPrefixMatch) return langPrefixMatch[1].toLowerCase();

	// Pattern: highlight-xxx
	const highlightMatch = className.match(/highlight-(\w+)/);
	if (highlightMatch) return highlightMatch[1].toLowerCase();

	// Pattern: brush: xxx (SyntaxHighlighter legacy)
	const brushMatch = className.match(/brush:\s*(\w+)/);
	if (brushMatch) return brushMatch[1].toLowerCase();

	// Fallback: check if any class token is a known language name
	const tokens = className.split(/\s+/);
	for (const token of tokens) {
		const lower = token.toLowerCase();
		if (KNOWN_LANGUAGES.has(lower)) return lower;
	}

	return '';
}

/**
 * Tracks reading position across multiple extractMarkdown calls,
 * allowing incremental content consumption without re-reading.
 */
export class ReadingState {
	private charOffset = 0;
	private totalLength = 0;
	private pageUrl = '';

	/**
	 * Get the current character offset for the next read.
	 */
	get currentOffset(): number {
		return this.charOffset;
	}

	/**
	 * Get the total length of the last-known content.
	 */
	get contentLength(): number {
		return this.totalLength;
	}

	/**
	 * Whether there is more content to read.
	 */
	get hasMore(): boolean {
		return this.charOffset < this.totalLength;
	}

	/**
	 * Fraction of content consumed so far (0..1).
	 */
	get progress(): number {
		if (this.totalLength === 0) return 0;
		return Math.min(1, this.charOffset / this.totalLength);
	}

	/**
	 * Advance the reading position by the given number of characters.
	 */
