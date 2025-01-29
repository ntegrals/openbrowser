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
