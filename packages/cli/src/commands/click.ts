import type { Command } from 'commander';
import chalk from 'chalk';
import { sessionManager } from '../globals.js';

export function registerClickCommand(program: Command): void {
	program
		.command('click')
		.description('Click on an element matching the given CSS selector')
		.argument('<selector>', 'CSS selector of the element to click')
		.option('-s, --session <id>', 'Session ID to use')
		.action(async (selector: string, options: { session?: string }) => {
			try {
				const browser = options.session
					? sessionManager.get(options.session)
					: sessionManager.getDefault();

				if (!browser) {
					console.error(chalk.red('No active session. Use "open" command first.'));
					process.exit(1);
				}

				await browser.click(selector);
				console.log(chalk.green('Clicked:'), selector);
			} catch (error) {
				console.error(chalk.red('Failed to click:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
