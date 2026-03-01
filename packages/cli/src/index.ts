#!/usr/bin/env bun
import { Command } from 'commander';
import { registerOpenCommand } from './commands/open.js';
import { registerClickCommand } from './commands/click.js';
import { registerTypeCommand } from './commands/type.js';
import { registerStateCommand } from './commands/state.js';
import { registerScreenshotCommand } from './commands/screenshot.js';
import { registerEvalCommand } from './commands/eval.js';
import { registerExtractCommand } from './commands/extract.js';
import { registerSessionsCommand } from './commands/sessions.js';
import { registerRunCommand } from './commands/run.js';
import { registerInteractiveCommand } from './commands/interactive.js';

const program = new Command();

program
	.name('open-browser')
	.description('AI-powered autonomous web browsing CLI')
	.version('0.1.0');

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
