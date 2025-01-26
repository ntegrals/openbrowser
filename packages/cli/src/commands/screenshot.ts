import type { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sessionManager } from '../globals.js';

export function registerScreenshotCommand(program: Command): void {
	program
		.command('screenshot')
		.description('Take a screenshot of the current page')
		.argument('[output]', 'Output file path', 'screenshot.png')
		.option('-s, --session <id>', 'Session ID to use')
		.option('--full-page', 'Capture the full page', false)
		.action(async (output: string, options: { session?: string; fullPage: boolean }) => {
			try {
				const browser = options.session
					? sessionManager.get(options.session)
					: sessionManager.getDefault();

				if (!browser) {
					console.error(chalk.red('No active session. Use "open" command first.'));
					process.exit(1);
				}

				const result = await browser.screenshot(options.fullPage);
				const buffer = Buffer.from(result.base64, 'base64');

				const outputPath = path.resolve(output);
				fs.writeFileSync(outputPath, buffer);

				console.log(chalk.green('Screenshot saved:'), outputPath);
				console.log(chalk.green('Dimensions:'), `${result.width}x${result.height}`);
			} catch (error) {
				console.error(chalk.red('Failed to take screenshot:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
