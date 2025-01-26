import type { Command } from 'commander';
import chalk from 'chalk';
import { sessionManager } from '../globals.js';

export function registerTypeCommand(program: Command): void {
	program
		.command('type')
		.description('Type text into an element matching the given CSS selector')
		.argument('<selector>', 'CSS selector of the input element')
		.argument('<text>', 'Text to type into the element')
		.option('-s, --session <id>', 'Session ID to use')
		.action(async (selector: string, text: string, options: { session?: string }) => {
			try {
				const browser = options.session
					? sessionManager.get(options.session)
					: sessionManager.getDefault();

				if (!browser) {
					console.error(chalk.red('No active session. Use "open" command first.'));
					process.exit(1);
				}

				await browser.type(selector, text);
				console.log(chalk.green('Typed into:'), selector);
			} catch (error) {
				console.error(chalk.red('Failed to type:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
