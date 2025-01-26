import * as readline from 'node:readline';
import type { Command } from 'commander';
import chalk from 'chalk';
import {
	Viewport,
	extractMarkdown,
} from 'open-browser';
import {
	Spinner,
	displayInfo,
	displayError,
	displaySeparator,
} from '../display.js';

interface InteractiveOptions {
	headless: boolean;
}

/**
 * Interactive REPL-like session for browser automation.
 * Supports commands: open, click, type, eval, extract, screenshot, state, back, forward, tabs, help, quit
 */
export function registerInteractiveCommand(program: Command): void {
	program
		.command('interactive')
		.alias('repl')
		.description('Start an interactive browser session (REPL mode)')
		.option('--headless', 'Run browser in headless mode', false)
		.action(async (options: InteractiveOptions) => {
			console.log(chalk.bold.white('Interactive Browser Session'));
			console.log(chalk.dim('Type "help" for available commands, "quit" to exit.'));
			displaySeparator();

			let browser: Viewport | null = null;

			try {
				const spinner = new Spinner('Starting browser...');
				spinner.start();

				browser = new Viewport({
					headless: options.headless,
				});
				await browser.start();

				spinner.stop(chalk.green('Browser ready.'));
				console.log('');

				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
					prompt: chalk.cyan('browser> '),
					terminal: true,
				});

				rl.prompt();

				rl.on('line', async (line) => {
					const trimmed = line.trim();
					if (!trimmed) {
						rl.prompt();
						return;
					}

					const [command, ...args] = parseCommandLine(trimmed);

					try {
						const shouldQuit = await handleCommand(
							command.toLowerCase(),
							args,
							browser!,
						);
						if (shouldQuit) {
							rl.close();
							return;
						}
					} catch (error) {
						displayError(
							error instanceof Error ? error.message : String(error),
						);
					}

					rl.prompt();
				});

				rl.on('close', async () => {
					console.log('');
					displayInfo('Closing browser session...');
					if (browser) {
						await browser.close().catch(() => {});
					}
					process.exit(0);
				});
			} catch (error) {
				displayError(
					error instanceof Error ? error.message : String(error),
				);
				if (browser) {
					await browser.close().catch(() => {});
				}
				process.exit(1);
			}
		});
}

// ── Command Parsing ──

function parseCommandLine(input: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let inQuote: string | null = null;

	for (const char of input) {
		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === ' ' || char === '\t') {
			if (current) {
				tokens.push(current);
				current = '';
			}
		} else {
			current += char;
		}
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

// ── Command Handler ──

async function handleCommand(
	command: string,
	args: string[],
	browser: Viewport,
): Promise<boolean> {
	switch (command) {
		case 'open':
		case 'goto':
		case 'navigate': {
			const url = args[0];
			if (!url) {
				displayError('Usage: open <url>');
				return false;
			}
			const spinner = new Spinner(`Navigating to ${url}...`);
			spinner.start();
			await browser.navigate(url);
			const finalUrl = browser.currentPage.url();
			spinner.stop(`${chalk.green('Loaded:')} ${finalUrl}`);
			return false;
		}

		case 'tap': {
			const selector = args.join(' ');
			if (!selector) {
				displayError('Usage: click <selector>');
				return false;
			}
			await browser.click(selector);
			console.log(chalk.green('Clicked:'), selector);
			return false;
		}

		case 'type': {
			const selector = args[0];
			const text = args.slice(1).join(' ');
			if (!selector || !text) {
				displayError('Usage: type <selector> <text>');
				return false;
			}
			await browser.type(selector, text);
			console.log(chalk.green('Typed:'), text);
			return false;
		}

		case 'eval':
		case 'js': {
			const expression = args.join(' ');
			if (!expression) {
				displayError('Usage: eval <expression>');
				return false;
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
			return false;
		}

		case 'extract':
		case 'markdown': {
			const spinner = new Spinner('Extracting page content...');
			spinner.start();
			const markdown = await extractMarkdown(browser.currentPage);
			spinner.stop();
			if (markdown) {
				// Show first 2000 chars
				const preview = markdown.length > 2000
					? `${markdown.slice(0, 2000)}\n${chalk.dim(`... (${markdown.length} chars total)`)}`
					: markdown;
				console.log(preview);
			} else {
				console.log(chalk.yellow('No content found.'));
			}
			return false;
		}

		case 'capture': {
			const outputPath = args[0] || 'screenshot.png';
			const result = await browser.screenshot(false);
			const fs = await import('node:fs');
			const path = await import('node:path');
			const buffer = Buffer.from(result.base64, 'base64');
			const resolved = path.resolve(outputPath);
			fs.writeFileSync(resolved, buffer);
			console.log(chalk.green('Screenshot saved:'), resolved);
			console.log(chalk.dim(`${result.width}x${result.height}`));
			return false;
		}

		case 'state':
		case 'info': {
			const state = await browser.getState();
			console.log(`${chalk.white('URL:')}   ${state.url}`);
			console.log(`${chalk.white('Title:')} ${state.title}`);
			if (state.tabs.length > 1) {
				console.log(`${chalk.white('Tabs:')}`);
				for (const tab of state.tabs) {
					const marker = tab.isActive ? chalk.cyan(' > ') : '   ';
					console.log(`${marker}[${tab.tabId}] ${tab.title || '(untitled)'} - ${tab.url}`);
				}
			}
			return false;
		}

		case 'back': {
			await browser.currentPage.goBack({ timeout: 5000 }).catch(() => {});
			console.log(chalk.green('Navigated back'));
			return false;
		}

		case 'forward': {
			await browser.currentPage.goForward({ timeout: 5000 }).catch(() => {});
			console.log(chalk.green('Navigated forward'));
			return false;
		}

		case 'tabs': {
			const state = await browser.getState();
			for (const tab of state.tabs) {
				const marker = tab.isActive ? chalk.cyan(' > ') : '   ';
				console.log(`${marker}[${tab.tabId}] ${tab.title || '(untitled)'} - ${tab.url}`);
			}
			return false;
		}

		case 'url': {
			console.log(browser.currentPage.url());
			return false;
		}

		case 'title': {
			const title = await browser.currentPage.title();
			console.log(title);
			return false;
		}

		case 'reload':
		case 'refresh': {
			await browser.currentPage.reload({ timeout: 10000 }).catch(() => {});
			console.log(chalk.green('Page reloaded'));
			return false;
		}

		case 'wait': {
			const ms = Number.parseInt(args[0] || '1000', 10);
			console.log(chalk.dim(`Waiting ${ms}ms...`));
			await new Promise((resolve) => setTimeout(resolve, ms));
			return false;
		}

		case 'help': {
			printHelp();
			return false;
		}

		case 'quit':
		case 'exit':
		case 'q': {
			return true;
		}

		default: {
			console.log(chalk.yellow(`Unknown command: ${command}`));
			console.log(chalk.dim('Type "help" for available commands.'));
			return false;
		}
	}
}

function printHelp(): void {
	console.log(chalk.bold('Available commands:'));
	console.log('');
	const commands = [
		['open <url>', 'Navigate to a URL'],
		['click <selector>', 'Click an element'],
		['type <selector> <text>', 'Type text into an element'],
		['eval <expression>', 'Run JavaScript in the browser'],
		['extract', 'Extract page content as markdown'],
		['screenshot [path]', 'Take a screenshot'],
		['state', 'Show current browser state'],
		['back', 'Navigate back'],
		['forward', 'Navigate forward'],
		['tabs', 'List open tabs'],
		['url', 'Show current URL'],
		['title', 'Show current page title'],
		['reload', 'Reload the current page'],
		['wait [ms]', 'Wait for the specified time'],
		['help', 'Show this help message'],
		['quit', 'Exit the interactive session'],
	];

	for (const [cmd, desc] of commands) {
		console.log(`  ${chalk.cyan(cmd.padEnd(25))} ${desc}`);
	}
}
