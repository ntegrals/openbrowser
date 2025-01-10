import type { CDPSession, Page } from 'playwright';
import { SnapshotBuilder } from './snapshot-builder.js';
import { TreeRenderer, type RendererOptions } from './renderer/tree-renderer.js';
import type {
	PageTreeNode,
	RenderedPageState,
	SelectorIndex,
	TargetInfo,
	TargetAllTrees,
	InteractedElement,
} from './types.js';
import { PageExtractionError } from '../errors.js';
import { createLogger } from '../logging.js';
import { timed } from '../telemetry.js';
import type { ElementRef } from '../types.js';

const logger = createLogger('dom');

export interface PageAnalyzerOptions {
	serializer?: Partial<RendererOptions>;
	capturedAttributes?: string[];
	maxIframes?: number;
	viewportExpansion?: number;
	maxElementsInDom?: number;
}

export class PageAnalyzer {
	private snapshotProcessor: SnapshotBuilder;
	private serializer: TreeRenderer;
	private capturedAttributes: string[];
	private maxIframes: number;
	private viewportExpansion: number;
	private maxElementsInDom: number;

	private cachedTree: PageTreeNode | null = null;
