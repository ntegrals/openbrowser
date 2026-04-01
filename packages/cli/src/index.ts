#!/usr/bin/env bun
import { Command } from 'commander';
import { LogLevel, parseLogLevel, setGlobalLogLevel } from 'open-browser';
import { registerClickCommand } from './commands/click.js';
import { registerEvalCommand } from './commands/eval.js';
import { registerExtractCommand } from './commands/extract.js';
import { registerInteractiveCommand } from './commands/interactive.js';
import { registerOpenCommand } from './commands/open.js';
import { registerRunCommand } from './commands/run.js';
import { registerScreenshotCommand } from './commands/screenshot.js';
import { registerSessionsCommand } from './commands/sessions.js';
import { registerStateCommand } from './commands/state.js';
import { registerTypeCommand } from './commands/type.js';

const program = new Command();

program
	.name('open-browser')
	.description('AI-powered autonomous web browsing CLI')
	.version('0.1.0')
	.option('--log-level <level>', 'Set log level (trace, debug, info, warn, error, silent)', 'info')
	.hook('preAction', (thisCommand) => {
		const level = thisCommand.opts().logLevel;
		if (level) {
			const parsed = parseLogLevel(level);
			if (parsed !== undefined) {
				setGlobalLogLevel(parsed);
			} else {
				console.error(`Unknown log level: ${level}. Valid: trace, debug, info, warn, error, silent`);
				process.exit(1);
			}
		}
	});

// ── Browser manipulation commands ──
registerOpenCommand(program);
registerClickCommand(program);
registerTypeCommand(program);
registerStateCommand(program);
registerScreenshotCommand(program);
registerEvalCommand(program);
registerExtractCommand(program);
registerSessionsCommand(program);

// ── Agent and interactive commands ──
registerRunCommand(program);
registerInteractiveCommand(program);

program.parse();
