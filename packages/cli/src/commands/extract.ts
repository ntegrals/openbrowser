import type { Command } from 'commander';
import chalk from 'chalk';
import { extractMarkdown } from 'open-browser';
import { sessionManager } from '../globals.js';

export function registerExtractCommand(program: Command): void {
	program
		.command('extract')
		.description('Extract content from the current page as markdown')
		.argument('<goal>', 'Description of what to extract (used as a label)')
		.option('-s, --session <id>', 'Session ID to use')
		.action(async (goal: string, options: { session?: string }) => {
			try {
				const browser = options.session
					? sessionManager.get(options.session)
					: sessionManager.getDefault();

				if (!browser) {
					console.error(chalk.red('No active session. Use "open" command first.'));
					process.exit(1);
				}

				console.log(chalk.dim(`Extracting: ${goal}`));

				const markdown = await extractMarkdown(browser.currentPage);

				if (!markdown) {
					console.log(chalk.yellow('No content extracted from the page.'));
				} else {
					console.log(markdown);
				}
			} catch (error) {
				console.error(chalk.red('Extraction failed:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
