import chalk from 'chalk';

// ── Spinner ──

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private frameIndex = 0;
	private message: string;

	constructor(message: string) {
		this.message = message;
	}

	start(): void {
		if (this.intervalId) return;
		this.frameIndex = 0;

		this.intervalId = setInterval(() => {
			const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
			process.stdout.write(`\r${chalk.cyan(frame)} ${this.message}`);
			this.frameIndex++;
		}, 80);
	}

	update(message: string): void {
		this.message = message;
	}

	stop(finalMessage?: string): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		// Clear the spinner line
		process.stdout.write('\r\x1b[K');
		if (finalMessage) {
			console.log(finalMessage);
		}
	}
}

// ── Step Display ──

export interface StepDisplayInfo {
	step: number;
	action: string;
	target?: string;
	durationMs: number;
	success: boolean;
	error?: string;
	extractedContent?: string;
}

/**
 * Format and display a single agent step with its result.
 */
export function displayStep(info: StepDisplayInfo): void {
	const stepLabel = chalk.bold.white(`Step ${info.step}`);
	const actionLabel = chalk.yellow(info.action);
	const durationLabel = chalk.dim(`${info.durationMs}ms`);
	const statusIcon = info.success ? chalk.green('✓') : chalk.red('✗');

	console.log(`${stepLabel} ${statusIcon} ${actionLabel} ${durationLabel}`);

	if (info.target) {
		console.log(`  ${chalk.dim('target:')} ${info.target}`);
	}

	if (info.error) {
		console.log(`  ${chalk.red('error:')} ${info.error}`);
	}

	if (info.extractedContent) {
		const preview = info.extractedContent.length > 120
			? `${info.extractedContent.slice(0, 120)}...`
			: info.extractedContent;
		console.log(`  ${chalk.dim('output:')} ${preview}`);
	}
}

// ── Cost Display ──

export interface CostDisplayInfo {
	inputTokens: number;
	outputTokens: number;
	totalCost: number;
}

/**
 * Display token usage and cost for a single step.
 */
export function displayStepCost(info: CostDisplayInfo): void {
	const tokens = chalk.dim(
		`tokens: ${info.inputTokens.toLocaleString()} in / ${info.outputTokens.toLocaleString()} out`,
	);
	const cost = chalk.dim(`cost: $${info.totalCost.toFixed(4)}`);
	console.log(`  ${tokens}  ${cost}`);
}

/**
 * Display a summary of total cost and token usage.
 */
export function displayTotalCost(info: CostDisplayInfo & { steps: number; durationMs: number }): void {
	console.log('');
	console.log(chalk.bold('Summary'));
	console.log(chalk.dim('─'.repeat(50)));
	console.log(`  ${chalk.white('Steps:')}        ${info.steps}`);
	console.log(`  ${chalk.white('Duration:')}     ${(info.durationMs / 1000).toFixed(1)}s`);
	console.log(`  ${chalk.white('Input tokens:')} ${info.inputTokens.toLocaleString()}`);
	console.log(`  ${chalk.white('Output tokens:')} ${info.outputTokens.toLocaleString()}`);
	console.log(`  ${chalk.white('Total tokens:')} ${(info.inputTokens + info.outputTokens).toLocaleString()}`);
	console.log(`  ${chalk.white('Total cost:')}   $${info.totalCost.toFixed(4)}`);
	console.log(chalk.dim('─'.repeat(50)));
}

// ── Progress Bar ──

export function displayProgressBar(current: number, total: number, width = 30): void {
	const ratio = Math.min(current / total, 1);
	const filled = Math.round(ratio * width);
	const empty = width - filled;
	const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
	const pct = (ratio * 100).toFixed(0).padStart(3);
	process.stdout.write(`\r  [${bar}] ${pct}% (${current}/${total})`);
}

// ── Result Display ──

export function displayResult(success: boolean, output?: string): void {
	console.log('');
	if (success) {
		console.log(chalk.bold.green('Task completed successfully'));
	} else {
		console.log(chalk.bold.red('Task failed'));
	}

	if (output) {
		console.log('');
		console.log(chalk.bold('Result:'));
		console.log(output);
	}
}

// ── Helpers ──

export function displayError(message: string): void {
	console.error(chalk.red('Error:'), message);
}

export function displayWarning(message: string): void {
	console.warn(chalk.yellow('Warning:'), message);
}

export function displayInfo(message: string): void {
	console.log(chalk.blue('Info:'), message);
}

export function displaySeparator(): void {
	console.log(chalk.dim('─'.repeat(60)));
}

export function displayHeader(title: string): void {
	console.log('');
	console.log(chalk.bold.white(title));
	console.log(chalk.dim('═'.repeat(60)));
}
