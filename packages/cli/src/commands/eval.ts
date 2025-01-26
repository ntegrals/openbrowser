import type { Command } from 'commander';
import chalk from 'chalk';
import { sessionManager } from '../globals.js';

export function registerEvalCommand(program: Command): void {
	program
		.command('eval')
		.description('Evaluate a JavaScript expression in the browser')
		.argument('<expression>', 'JavaScript expression to evaluate')
		.option('-s, --session <id>', 'Session ID to use')
		.action(async (expression: string, options: { session?: string }) => {
			try {
				const browser = options.session
					? sessionManager.get(options.session)
					: sessionManager.getDefault();

				if (!browser) {
					console.error(chalk.red('No active session. Use "open" command first.'));
					process.exit(1);
				}

				const result = await browser.evaluate(expression);

				if (result === undefined) {
					console.log(chalk.dim('undefined'));
				} else if (result === null) {
					console.log(chalk.dim('null'));
				} else if (typeof result === 'object') {
					console.log(JSON.stringify(result, null, 2));
				} else {
					console.log(String(result));
				}
			} catch (error) {
				console.error(chalk.red('Evaluation failed:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
