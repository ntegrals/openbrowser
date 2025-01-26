import type { Command } from 'commander';
import chalk from 'chalk';
import { sessionManager } from '../globals.js';

export function registerOpenCommand(program: Command): void {
	program
		.command('open')
		.description('Open a URL in the browser')
		.argument('<url>', 'URL to navigate to')
		.option('--headless', 'Run in headless mode', false)
		.option('-s, --session <id>', 'Reuse an existing session')
		.action(async (url: string, options: { headless: boolean; session?: string }) => {
			try {
				let sessionId = options.session;

				if (sessionId) {
					const browser = sessionManager.get(sessionId);
					if (!browser) {
						console.error(chalk.red(`Session "${sessionId}" not found.`));
						process.exit(1);
					}
					await browser.navigate(url);
				} else {
					// Try to reuse the default session, or create a new one
					sessionId = sessionManager.getDefaultId();

					if (!sessionId) {
						sessionId = await sessionManager.create({
							headless: options.headless,
						});
					}

					const browser = sessionManager.get(sessionId)!;
					await browser.navigate(url);
				}

				const browser = sessionManager.get(sessionId)!;
				const finalUrl = browser.currentPage.url();

				console.log(chalk.green('Session:'), sessionId);
				console.log(chalk.green('URL:'), finalUrl);
			} catch (error) {
				console.error(chalk.red('Failed to open URL:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
