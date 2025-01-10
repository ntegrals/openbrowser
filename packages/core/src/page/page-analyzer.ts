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
	private cachedSelectorMap: SelectorIndex | null = null;
	private interactedElements: InteractedElement[] = [];
	private hiddenElementHints: string[] = [];

	constructor(options?: PageAnalyzerOptions) {
		this.snapshotProcessor = new SnapshotBuilder();
		this.capturedAttributes = options?.capturedAttributes ?? [
			'title', 'type', 'name', 'role', 'tabindex',
			'aria-label', 'placeholder', 'value', 'alt', 'aria-expanded',
		];
		this.maxIframes = options?.maxIframes ?? 3;
		this.viewportExpansion = options?.viewportExpansion ?? 0;
		this.maxElementsInDom = options?.maxElementsInDom ?? 2000;
		this.serializer = new TreeRenderer({
			capturedAttributes: this.capturedAttributes,
			maxElementsInDom: this.maxElementsInDom,
			...options?.serializer,
		});
	}

	async extractState(
		page: Page,
		cdpSession: CDPSession,
	): Promise<RenderedPageState> {
		const { result } = await timed('dom-extract', () =>
			this._extractState(page, cdpSession),
		);
		return result;
	}

	private async _extractState(
		page: Page,
		cdpSession: CDPSession,
	): Promise<RenderedPageState> {
		try {
