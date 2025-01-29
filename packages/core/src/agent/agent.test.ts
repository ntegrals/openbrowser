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
