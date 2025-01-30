import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { Agent, type AgentOptions } from '../agent/agent.js';
import type { PageAnalyzer } from '../page/page-analyzer.js';

// ── Mock PageAnalyzer factory (injected via AgentOptions.domService) ──

const mockExtractState = mock(async () => ({
	tree: '<div>[1] <button>Click me</button></div>',
	selectorMap: { 1: 'button' },
	elementCount: 10,
	interactiveElementCount: 1,
	scrollPosition: { x: 0, y: 0 },
	viewportSize: { width: 1280, height: 1100 },
	documentSize: { width: 1280, height: 2000 },
	pixelsAbove: 0,
	pixelsBelow: 900,
}));

function createMockPageAnalyzer(): PageAnalyzer {
	return {
		extractState: mockExtractState,
		clickElementByIndex: mock(async () => {}),
		getCachedTree: mock(() => null),
		getCachedSelectorMap: mock(() => null),
		clearCache: mock(() => {}),
		getInteractedElements: mock(() => []),
		clearInteractedElements: mock(() => {}),
		getElementSelector: mock(async () => undefined),
		getElementByBackendNodeId: mock(async () => null),
		clickAtCoordinates: mock(async () => {}),
		inputTextByIndex: mock(async () => {}),
		extractWithIframes: mock(async () => ({ mainTree: null, iframeTrees: [] })),
	} as unknown as PageAnalyzer;
}
import type { RunOutcome } from './types.js';
import type { LanguageModel, InferenceOptions } from '../model/interface.js';
import type { InferenceResult, InferenceUsage } from '../model/types.js';
import type { Viewport } from '../viewport/viewport.js';
import type { ViewportSnapshot } from '../viewport/types.js';
import type { CommandExecutor } from '../commands/executor.js';
import type { Command, CommandResult, ExecutionContext } from '../commands/types.js';
import type { CommandCatalog } from '../commands/catalog/catalog.js';

// ── Mock Factories ──

function createMockUsage(input = 100, output = 50): InferenceUsage {
	return { inputTokens: input, outputTokens: output, totalTokens: input + output };
}

function createMockModel(options?: {
	responses?: Array<{
		currentState: { evaluation: string; memory: string; nextGoal: string };
		actions: Command[];
	}>;
	modelId?: string;
}): LanguageModel {
	let callCount = 0;
	const responses = options?.responses ?? [
		{
			currentState: {
				evaluation: 'Page loaded',
				memory: '',
				nextGoal: 'Click element',
			},
			actions: [{ action: 'tap', index: 1, clickCount: 1 } as Command],
		},
	];

	return {
		modelId: options?.modelId ?? 'test-model',
		provider: 'custom',
		invoke: async <T>(_options: InferenceOptions<T>): Promise<InferenceResult<T>> => {
			const responseIndex = Math.min(callCount, responses.length - 1);
			callCount++;
			return {
				parsed: responses[responseIndex] as unknown as T,
				usage: createMockUsage(),
				finishReason: 'stop',
			};
		},
	};
}

function createDoneOnStepModel(doneOnStep: number, result = 'Task completed'): LanguageModel {
	const responses: Array<{
		currentState: { evaluation: string; memory: string; nextGoal: string };
		actions: Command[];
	}> = [];

	for (let i = 1; i < doneOnStep; i++) {
		responses.push({
			currentState: {
				evaluation: `Step ${i} assessment`,
				memory: '',
				nextGoal: `Goal for step ${i + 1}`,
			},
			actions: [{ action: 'tap', index: i, clickCount: 1 } as Command],
		});
	}

	responses.push({
		currentState: {
			evaluation: 'Task done',
			memory: '',
			nextGoal: 'Report result',
		},
		actions: [{ action: 'finish', text: result, success: true } as Command],
	});

	return createMockModel({ responses });
}

function createMockBrowserState(): ViewportSnapshot {
	return {
		url: 'https://example.com',
		title: 'Example Page',
		tabs: [
			{ tabId: 0 as any, url: 'https://example.com', title: 'Example Page', isActive: true },
		],
		activeTabIndex: 0,
	};
}

function createMockRegistry(): CommandCatalog{
	return {
		register: mock(() => {}),
		get: mock(() => undefined),
		getAll: mock(() => []),
		getActionDescriptions: mock(() => 'click: Click on an element'),
		getPromptDescription: mock(() => 'click: Click on an element by its index\ngo_to_url: Navigate to a URL'),
		has: mock(() => false),
	} as unknown as CommandCatalog;
}

function createMockTools(actionResults?: CommandResult[]): CommandExecutor {
	const defaultResults: CommandResult[] = [{ success: true }];
	return {
		registry: createMockRegistry(),
		commandsPerStep: 10,
		setCoordinateClicking: mock(() => {}),
		executeActions: mock(async (_actions: Command[], _ctx: ExecutionContext) => {
			return actionResults ?? defaultResults;
		}),
		executeAction: mock(async (_action: Command, _ctx: ExecutionContext) => {
			return (actionResults ?? defaultResults)[0];
		}),
	} as unknown as CommandExecutor;
}

function createMockBrowser(overrides?: {
	browserState?: ViewportSnapshot;
	isConnected?: boolean;
}): Viewport {
	const state = overrides?.browserState ?? createMockBrowserState();
	return {
		isConnected: overrides?.isConnected ?? true,
		start: mock(async () => {}),
		getState: mock(async () => state),
		screenshot: mock(async () => ({ base64: 'fake_screenshot', width: 1280, height: 1100 })),
		navigate: mock(async () => {}),
		currentPage: {
			viewportSize: () => ({ width: 1280, height: 1100 }),
			evaluate: mock(async () => ({})),
		} as any,
		cdp: {
			send: mock(async () => ({})),
		} as any,
	} as unknown as Viewport;
}

function createDefaultAgentOptions(overrides?: Partial<AgentOptions>): AgentOptions {
	return {
		task: 'Find the price of the product',
		model: createDoneOnStepModel(2),
		browser: createMockBrowser(),
		tools: createMockTools([{ success: true, isDone: false }]),
		domService: createMockPageAnalyzer(),
		settings: {
			stepLimit: 5,
			enableScreenshots: false,
			commandDelayMs: 0,
			retryDelay: 0,
			autoNavigateToUrls: false,
			contextWindowSize: 50000,
		},
		...overrides,
	};
}

// ── Tests ──

describe('Agent', () => {
	describe('constructor', () => {
		test('creates agent with default settings merged', () => {
			const agent = new Agent(createDefaultAgentOptions());
			const state = agent.getState();
			expect(state.step).toBe(0);
			expect(state.isRunning).toBe(false);
			expect(state.isDone).toBe(false);
			expect(state.failureCount).toBe(0);
			expect(state.consecutiveFailures).toBe(0);
		});

		test('overrides default settings with provided values', () => {
			const agent = new Agent(
				createDefaultAgentOptions({
					settings: {
						stepLimit: 50,
						enableScreenshots: false,
						commandDelayMs: 0,
						retryDelay: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
					},
				}),
			);
			const state = agent.getState();
			expect(state.stepLimit).toBe(50);
		});

		test('initializes cost tracking to zero', () => {
			const agent = new Agent(createDefaultAgentOptions());
			const cost = agent.getAccumulatedCost();
			expect(cost.totalCost).toBe(0);
			expect(cost.totalInputTokens).toBe(0);
			expect(cost.totalOutputTokens).toBe(0);
		});

		test('initializes empty history', () => {
			const agent = new Agent(createDefaultAgentOptions());
			const history = agent.getHistory();
			expect(history.entries).toHaveLength(0);
			expect(history.task).toBe('Find the price of the product');
		});

		test('uses custom tools when provided', () => {
			const customTools = createMockTools();
			const agent = new Agent(createDefaultAgentOptions({ tools: customTools }));
			expect(agent).toBeDefined();
		});
	});

	describe('run() basic flow', () => {
		test('completes when done action is returned', async () => {
			const doneModel = createDoneOnStepModel(1, 'The price is $42');
			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'The price is $42' },
			]);

			const agent = new Agent(
				createDefaultAgentOptions({ model: doneModel, tools }),
			);

			const result = await agent.run();

			expect(result.finalResult).toBe('The price is $42');
			expect(result.success).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test('sets isRunning to false after completion', async () => {
			const doneModel = createDoneOnStepModel(1, 'Done');
			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'Done' },
			]);

			const agent = new Agent(
				createDefaultAgentOptions({ model: doneModel, tools }),
			);
			await agent.run();

			const state = agent.getState();
			expect(state.isRunning).toBe(false);
		});

		test('calls onStepStart callback', async () => {
			const stepStarts: number[] = [];

			const doneModel = createDoneOnStepModel(2, 'Result');
			let callCount = 0;
			const tools = createMockTools();
			(tools.executeActions as any) = mock(async () => {
				callCount++;
				if (callCount >= 2) {
					return [{ success: true, isDone: true, extractedContent: 'Result' }];
				}
				return [{ success: true }];
			});

			const agent = new Agent(
				createDefaultAgentOptions({
					model: doneModel,
					tools,
					onStepStart: (step) => stepStarts.push(step),
				}),
			);

			await agent.run();

			expect(stepStarts.length).toBeGreaterThan(0);
			expect(stepStarts[0]).toBe(1);
		});

		test('calls onDone callback with result', async () => {
			let doneResult: RunOutcome | undefined;

			const doneModel = createDoneOnStepModel(1, 'Final answer');
			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'Final answer' },
			]);

			const agent = new Agent(
				createDefaultAgentOptions({
					model: doneModel,
					tools,
					onDone: (r) => { doneResult = r; },
				}),
			);

			await agent.run();

			expect(doneResult).toBeDefined();
			expect(doneResult!.finalResult).toBe('Final answer');
		});

		test('starts browser if not connected', async () => {
			const browser = createMockBrowser({ isConnected: false });
			const doneModel = createDoneOnStepModel(1, 'Result');
			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'Result' },
			]);

			const agent = new Agent(
				createDefaultAgentOptions({ browser, model: doneModel, tools }),
			);
			await agent.run();

			expect(browser.start).toHaveBeenCalled();
		});
	});

	describe('step execution', () => {
		test('invokes browser.getState() on each step', async () => {
			const browser = createMockBrowser();
			const doneModel = createDoneOnStepModel(1, 'Done');
			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'Done' },
			]);

			const agent = new Agent(
				createDefaultAgentOptions({ browser, model: doneModel, tools }),
			);
			await agent.run();

			expect(browser.getState).toHaveBeenCalled();
		});

		test('invokes PageAnalyzer.extractState on each step', async () => {
			const doneModel = createDoneOnStepModel(1, 'Done');
			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'Done' },
			]);

			mockExtractState.mockClear();
			const agent = new Agent(
				createDefaultAgentOptions({ model: doneModel, tools }),
			);
			await agent.run();

			expect(mockExtractState).toHaveBeenCalled();
		});

		test('records history entries for each step', async () => {
			let callCount = 0;
			const tools = createMockTools();
			(tools.executeActions as any) = mock(async () => {
				callCount++;
				if (callCount >= 3) {
					return [{ success: true, isDone: true, extractedContent: 'Done' }];
				}
				return [{ success: true }];
			});

			const model = createDoneOnStepModel(3, 'Done');
			const agent = new Agent(
				createDefaultAgentOptions({ model, tools }),
			);
			await agent.run();

			const history = agent.getHistory();
			expect(history.entries.length).toBeGreaterThanOrEqual(1);
		});

		test('token usage is tracked across steps', async () => {
			let callCount = 0;
			const tools = createMockTools();
			(tools.executeActions as any) = mock(async () => {
				callCount++;
				if (callCount >= 2) {
					return [{ success: true, isDone: true, extractedContent: 'Done' }];
				}
				return [{ success: true }];
			});

			const model = createDoneOnStepModel(2, 'Done');
			const agent = new Agent(
				createDefaultAgentOptions({ model, tools }),
			);
			await agent.run();

			const state = agent.getState();
			expect(state.totalInputTokens).toBeGreaterThan(0);
			expect(state.totalOutputTokens).toBeGreaterThan(0);
		});
	});

	describe('failure recovery', () => {
		test('consecutive failures increment failure count', async () => {
			let callCount = 0;
			const errorModel: LanguageModel = {
				modelId: 'test-model',
				provider: 'custom',
				invoke: async <T>(): Promise<InferenceResult<T>> => {
					callCount++;
					throw new Error(`Simulated error ${callCount}`);
				},
			};

			const agent = new Agent(
				createDefaultAgentOptions({
					model: errorModel,
					settings: {
						stepLimit: 10,
						failureThreshold: 3,
						retryDelay: 0,
						enableScreenshots: false,
						commandDelayMs: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
					},
				}),
			);

			const result = await agent.run();
			expect(result.errors.length).toBeGreaterThan(0);
		});

		test('agent records error about consecutive failures after failureThreshold', async () => {
			let callCount = 0;
			const errorModel: LanguageModel = {
				modelId: 'test-model',
				provider: 'custom',
				invoke: async <T>(): Promise<InferenceResult<T>> => {
					callCount++;
					throw new Error(`Error ${callCount}`);
				},
			};

			const agent = new Agent(
				createDefaultAgentOptions({
					model: errorModel,
					settings: {
						stepLimit: 20,
						failureThreshold: 3,
						retryDelay: 0,
						enableScreenshots: false,
						commandDelayMs: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
					},
				}),
			);

			const result = await agent.run();
			const hasFailureError = result.errors.some(
				(e) => e.includes('consecutive failures'),
			);
			expect(hasFailureError).toBe(true);
		});

		test('successful step resets consecutive failure count', async () => {
			let callCount = 0;
			const model: LanguageModel = {
				modelId: 'test-model',
				provider: 'custom',
				invoke: async <T>(): Promise<InferenceResult<T>> => {
					callCount++;
					if (callCount === 1) {
						throw new Error('Transient error');
					}
					return {
						parsed: {
							currentState: { evaluation: 'Done', memory: '', nextGoal: '' },
							actions: [{ action: 'finish', text: 'Success', success: true }],
						} as unknown as T,
						usage: createMockUsage(),
						finishReason: 'stop',
					};
				},
			};

			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'Success' },
			]);

			const agent = new Agent(
				createDefaultAgentOptions({
					model,
					tools,
					settings: {
						stepLimit: 10,
						failureThreshold: 5,
						retryDelay: 0,
						enableScreenshots: false,
						commandDelayMs: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
					},
				}),
			);

			const result = await agent.run();
			expect(result.finalResult).toBe('Success');
		});
	});

	describe('done action detection and result extraction', () => {
		test('detects done action and extracts result text', async () => {
			const tools = createMockTools([
				{ success: true, isDone: true, extractedContent: 'Product costs $99' },
			]);

			const model = createDoneOnStepModel(1, 'Product costs $99');
			const agent = new Agent(
				createDefaultAgentOptions({ model, tools }),
			);
			const result = await agent.run();

			expect(result.finalResult).toBe('Product costs $99');
			expect(result.success).toBe(true);
		});

		test('handles done action with success=false', async () => {
			const model = createMockModel({
				responses: [{
					currentState: { evaluation: 'Cannot find', memory: '', nextGoal: '' },
					actions: [{ action: 'finish', text: 'Could not find', success: false } as Command],
				}],
			});

			const tools = createMockTools([
				{ success: false, isDone: true, extractedContent: 'Could not find' },
			]);

			const agent = new Agent(
				createDefaultAgentOptions({ model, tools }),
			);
			const result = await agent.run();

			expect(result.finalResult).toBe('Could not find');
			expect(result.success).toBe(false);
		});
	});

	describe('pause / resume / stop', () => {
		test('pause sets isPaused flag', () => {
			const agent = new Agent(createDefaultAgentOptions());
			agent.pause();
			expect(agent.getState().isPaused).toBe(true);
		});

		test('resume clears isPaused flag', () => {
			const agent = new Agent(createDefaultAgentOptions());
			agent.pause();
			agent.resume();
			expect(agent.getState().isPaused).toBe(false);
		});

		test('stop sets isRunning to false', async () => {
			let stepCount = 0;
			const tools = createMockTools();
			(tools.executeActions as any) = mock(async () => {
				stepCount++;
				return [{ success: true }];
			});

			const model = createMockModel();
			const agent = new Agent(
				createDefaultAgentOptions({
					model,
					tools,
					settings: {
						stepLimit: 100,
						enableScreenshots: false,
						commandDelayMs: 0,
						retryDelay: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
					},
				}),
			);

			const runPromise = agent.run();

			// Stop after a brief moment
			await new Promise((r) => setTimeout(r, 50));
			agent.stop();

			await runPromise;
			const state = agent.getState();
			expect(state.isRunning).toBe(false);
		});
	});

	describe('max steps reached', () => {
		test('returns error when max steps exceeded without done', async () => {
			const model = createMockModel();
			const tools = createMockTools([{ success: true }]);

			const agent = new Agent(
				createDefaultAgentOptions({
					model,
					tools,
					settings: {
						stepLimit: 3,
						enableScreenshots: false,
						commandDelayMs: 0,
						retryDelay: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
					},
				}),
			);

			const result = await agent.run();

			const hasMaxStepsError = result.errors.some(
				(e) => e.includes('maximum steps'),
			);
			expect(hasMaxStepsError).toBe(true);
		});

		test('run() accepts stepLimit parameter to override settings', async () => {
			const model = createMockModel();
			const tools = createMockTools([{ success: true }]);

			const agent = new Agent(
				createDefaultAgentOptions({
					model,
					tools,
					settings: {
						stepLimit: 100,
						enableScreenshots: false,
						commandDelayMs: 0,
						retryDelay: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
					},
				}),
			);

			const result = await agent.run(2);

			const hasMaxStepsError = result.errors.some(
				(e) => e.includes('maximum steps'),
			);
			expect(hasMaxStepsError).toBe(true);
		});
	});

	describe('sensitive data filtering', () => {
		test('filters sensitive values from action results', async () => {
			const tools = createMockTools([
				{
					success: true,
					isDone: true,
					extractedContent: 'Your API key is sk-12345 and password is hunter2',
				},
			]);

			const model = createDoneOnStepModel(1, 'Done');
			const agent = new Agent(
				createDefaultAgentOptions({
					model,
					tools,
					settings: {
						stepLimit: 5,
						enableScreenshots: false,
						commandDelayMs: 0,
						retryDelay: 0,
						autoNavigateToUrls: false,
						contextWindowSize: 50000,
						maskedValues: {
							apiKey: 'sk-12345',
							password: 'hunter2',
						},
					},
				}),
			);

			const result = await agent.run();

			const history = agent.getHistory();
			for (const entry of history.entries) {
				for (const ar of entry.actionResults) {
					if (ar.extractedContent) {
						expect(ar.extractedContent).not.toContain('sk-12345');
						expect(ar.extractedContent).not.toContain('hunter2');
					}
				}
			}
		});

		test('returns unmodified results when no sensitive data configured', async () => {
			const tools = createMockTools([
				{
					success: true,
					isDone: true,
					extractedContent: 'Plain text result',
				},
