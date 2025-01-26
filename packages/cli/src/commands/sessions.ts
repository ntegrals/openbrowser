import type { Command } from 'commander';
import chalk from 'chalk';
import { sessionManager } from '../globals.js';

export function registerSessionsCommand(program: Command): void {
	program
		.command('sessions')
		.description('List all active browser sessions')
		.action(() => {
			try {
				const sessions = sessionManager.list();

				if (sessions.length === 0) {
					console.log(chalk.yellow('No active sessions.'));
					return;
				}

				console.log(chalk.bold(`Active Sessions (${sessions.length}):`));
				for (const session of sessions) {
					const created = new Date(session.createdAt).toLocaleTimeString();
					const accessed = new Date(session.lastAccessedAt).toLocaleTimeString();
					console.log(`  ${chalk.cyan(session.id)}  created ${created}  last used ${accessed}`);
				}
			} catch (error) {
				console.error(chalk.red('Failed to list sessions:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});

	program
		.command('sessions:close')
		.description('Close a specific session or all sessions')
		.argument('[id]', 'Session ID to close (omit to close all)')
		.action(async (id?: string) => {
			try {
				if (id) {
					const closed = await sessionManager.close(id);
					if (closed) {
						console.log(chalk.green('Closed session:'), id);
					} else {
						console.error(chalk.red(`Session "${id}" not found.`));
						process.exit(1);
					}
				} else {
					const count = sessionManager.activeCount;
					await sessionManager.closeAll();
					console.log(chalk.green(`Closed ${count} session(s).`));
				}
			} catch (error) {
				console.error(chalk.red('Failed to close session:'), error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
