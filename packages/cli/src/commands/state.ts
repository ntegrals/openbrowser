import type { Command } from 'commander';
import chalk from 'chalk';
import { sessionManager } from '../globals.js';

export function registerStateCommand(program: Command): void {
	program
		.command('state')
		.description('Print the current browser state (URL, title, tabs)')
		.option('-s, --session <id>', 'Session ID to use')
		.action(async (options: { session?: string }) => {
			try {
				const browser = options.session
					? sessionManager.get(options.session)
					: sessionManager.getDefault();

				if (!browser) {
					console.error(chalk.red('No active session. Use "open" command first.'));
					process.exit(1);
				}

				const state = await browser.getState();

				console.log(chalk.bold('Browser State'));
				console.log(chalk.green('URL:'), state.url);
				console.log(chalk.green('Title:'), state.title);
				console.log(chalk.green('Tabs:'), state.tabs.length);

				for (const tab of state.tabs) {
					const marker = tab.isActive ? chalk.cyan('→') : ' ';
					console.log(`  ${marker} [${tab.tabId}] ${tab.title || '(untitled)'} - ${tab.url}`);
				}
			} catch (error) {
				console.error(chalk.red('Failed to get state:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
