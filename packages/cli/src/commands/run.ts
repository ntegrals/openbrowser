import type { Command } from 'commander';
import chalk from 'chalk';
import {
	Agent,
	Viewport,
	VercelModelAdapter,
	type LanguageModel,
	type CommandResult,
	type StepRecord,
} from 'open-browser';
import {
	Spinner,
	displayStep,
	displayTotalCost,
	displayResult,
	displayHeader,
	displaySeparator,
	displayError,
} from '../display.js';

interface RunOptions {
	model: string;
	provider: string;
	headless: boolean;
	stepLimit: number;
	verbose: boolean;
	noCost: boolean;
}

/**
 * Dynamically import and create a Vercel AI SDK language model
 * based on the provider and model ID strings.
 */
async function createModel(provider: string, modelId: string): Promise<LanguageModel> {
	let languageModel: import('ai').LanguageModelV1;

	switch (provider) {
		case 'openai': {
			const { createOpenAI } = await import('@ai-sdk/openai');
			const openai = createOpenAI({});
			languageModel = openai(modelId);
			break;
		}
		case 'anthropic': {
			const { createAnthropic } = await import('@ai-sdk/anthropic');
			const anthropic = createAnthropic({});
			languageModel = anthropic(modelId);
			break;
		}
		case 'google': {
			const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
			const google = createGoogleGenerativeAI({});
			languageModel = google(modelId);
			break;
		}
		default:
			throw new Error(
				`Unsupported provider: ${provider}. ` +
				'Supported: openai, anthropic, google',
			);
	}

	return new VercelModelAdapter({ model: languageModel });
}

export function registerRunCommand(program: Command): void {
	program
		.command('run')
		.description('Run an AI agent to complete a browser task')
		.argument('<task>', 'Description of the task for the agent to complete')
		.option('-m, --model <model>', 'Model ID to use', 'gpt-4o')
		.option('-p, --provider <provider>', 'LLM provider (openai, anthropic, google)', 'openai')
		.option('--headless', 'Run browser in headless mode', true)
		.option('--no-headless', 'Show the browser window')
		.option('--max-steps <n>', 'Maximum number of agent steps', '25')
		.option('-v, --verbose', 'Show detailed step information', false)
		.option('--no-cost', 'Hide cost tracking information')
		.action(async (task: string, options: RunOptions) => {
			const stepLimit = Number.parseInt(String(options.stepLimit), 10);

			displayHeader(`Agent Task: ${task}`);
			console.log(
				`${chalk.dim('model:')} ${options.model}  ` +
				`${chalk.dim('provider:')} ${options.provider}  ` +
				`${chalk.dim('max steps:')} ${stepLimit}`,
			);
			displaySeparator();

			const spinner = new Spinner('Starting browser...');
			spinner.start();

			let browser: Viewport | null = null;

			try {
				// Initialize the LLM
				spinner.update('Loading model...');
				const model = await createModel(options.provider, options.model);

				// Initialize the browser
				spinner.update('Starting browser...');
				browser = new Viewport({
					headless: options.headless,
				});
				await browser.start();
				spinner.update('Browser ready, starting agent...');

				// Track per-step timing
				const stepTimings = new Map<number, number>();
				let currentStepStart = 0;

				// Create the agent
				const agent = new Agent({
					task,
					model,
					browser,
					settings: {
						stepLimit,
					},
					onStepStart: (step) => {
						currentStepStart = Date.now();
						stepTimings.set(step, currentStepStart);
						spinner.update(`Step ${step}: thinking...`);
					},
					onStepEnd: (step, results) => {
						const durationMs = Date.now() - (stepTimings.get(step) ?? currentStepStart);

						spinner.stop();

						// Display each action result for this step
						for (const result of results) {
							displayStep({
								step,
								action: extractActionName(result),
								target: extractActionTarget(result),
								durationMs,
								success: result.success,
								error: result.error,
								extractedContent: result.extractedContent,
							});
						}

						if (options.verbose) {
							displaySeparator();
						}

						// Restart spinner for next step
						spinner.start();
						spinner.update(`Step ${step + 1}: thinking...`);
					},
				});

				spinner.update('Agent running...');

				// Execute the agent
				const result = await agent.run();

				spinner.stop();

				// Display result
				displayResult(result.success, result.finalResult);

				// Display cost summary
				if (!options.noCost && result.totalCost) {
					displayTotalCost({
						steps: result.history.entries.length,
						inputTokens: result.totalCost.totalInputTokens,
						outputTokens: result.totalCost.totalOutputTokens,
						totalCost: result.totalCost.totalCost,
						durationMs: computeTotalDuration(result.history.entries),
					});
				} else if (!options.noCost) {
					// Show basic timing even without cost data
					const totalMs = computeTotalDuration(result.history.entries);
					console.log('');
					console.log(
						chalk.dim(
							`Completed in ${result.history.entries.length} step(s), ` +
							`${(totalMs / 1000).toFixed(1)}s`,
						),
					);
				}

				// Display errors if any
				if (result.errors.length > 0) {
					console.log('');
					console.log(chalk.bold.yellow('Errors encountered:'));
					for (const err of result.errors) {
						console.log(`  ${chalk.red('-')} ${err}`);
					}
				}

				// Exit with appropriate code
				process.exit(result.success ? 0 : 1);
			} catch (error) {
				spinner.stop();
				displayError(
					error instanceof Error ? error.message : String(error),
				);
				process.exit(1);
			} finally {
				if (browser) {
					await browser.close().catch(() => {});
				}
			}
		});
}

// ── Helpers ──

function extractActionName(result: CommandResult): string {
	if (result.isDone) return 'done';
	if (result.extractedContent) return 'extract';
	return result.success ? 'action' : 'failed_action';
}

function extractActionTarget(result: CommandResult): string | undefined {
	if (result.extractedContent) {
		return result.extractedContent.slice(0, 80);
	}
	return undefined;
}

function computeTotalDuration(entries: StepRecord[]): number {
	return entries.reduce((sum, e) => sum + e.duration, 0);
}
