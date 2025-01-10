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
			// Capture CDP snapshot
			const { domSnapshot, axTree } = await this.snapshotProcessor.captureSnapshot(cdpSession);

			// Get viewport and document info
			const [viewportSize, scrollPosition, documentSize] = await Promise.all([
				page.viewportSize() ?? { width: 1280, height: 1100 },
				page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
				page.evaluate(() => ({
					width: document.documentElement.scrollWidth,
					height: document.documentElement.scrollHeight,
				})),
			]);

			// Build enhanced DOM tree
			const { root } = this.snapshotProcessor.buildTree(
				domSnapshot,
				axTree,
				viewportSize,
				this.capturedAttributes,
			);

			// Traverse shadow DOM roots and merge their children into the main tree
			this.integrateShadowDOMChildren(root);

			// Filter interactive elements by viewport visibility threshold.
			// Elements far outside the expanded viewport are stripped of their
			// highlight index so they do not clutter the serialized output.
			if (this.viewportExpansion >= 0) {
				this.applyViewportThresholdFilter(root, viewportSize, scrollPosition);
			}

			this.cachedTree = root;

			// Collect hidden element hints for scroll guidance
			this.hiddenElementHints = this.collectHiddenElementHints(
				root,
				viewportSize,
				scrollPosition,
			);

			// Serialize for LLM
			const state = this.serializer.serializeTree(
				root,
				scrollPosition,
				viewportSize,
				documentSize,
			);

			this.cachedSelectorMap = state.selectorMap;

			// Append hidden element hints
			if (this.hiddenElementHints.length > 0) {
				state.tree += '\n\n--- Hidden interactive elements (scroll to access) ---\n';
				state.tree += this.hiddenElementHints.slice(0, 10).join('\n');
				if (this.hiddenElementHints.length > 10) {
					state.tree += `\n... and ${this.hiddenElementHints.length - 10} more`;
				}
			}

			logger.debug(
				`Extracted DOM: ${state.elementCount} elements, ${state.interactiveElementCount} interactive`,
			);

			return state;
		} catch (error) {
			throw new PageExtractionError(
				`Failed to extract DOM state: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error instanceof Error ? error : undefined },
			);
		}
	}

	/**
	 * Discover cross-origin iframes and extract their DOM trees via CDP Target discovery.
	 * For same-origin iframes, uses Playwright frame evaluation.
	 * For cross-origin iframes, attaches CDP sessions to their targets and extracts DOM snapshots.
	 */
	async extractWithIframes(
		page: Page,
		cdpSession: CDPSession,
	): Promise<TargetAllTrees> {
		const mainTree = await this._extractState(page, cdpSession).then(() => this.cachedTree!);

		const iframeTrees: TargetAllTrees['iframeTrees'] = [];

		try {
			const frames = page.frames().slice(0, this.maxIframes + 1); // +1 for main
			const processedUrls = new Set<string>();

			for (const frame of frames.slice(1, this.maxIframes + 1)) {
				try {
					const url = frame.url();
					if (!url || url === 'about:blank' || processedUrls.has(url)) continue;
					processedUrls.add(url);

					const targetInfo: TargetInfo = {
						targetId: url,
						type: 'iframe',
						url,
						attached: true,
					};

					// Try same-origin access first via Playwright frame evaluation
					const html = await frame.evaluate(() => document.body?.innerHTML ?? '').catch(() => '');
					if (html) {
						iframeTrees.push({
							targetInfo,
							tree: {
								tagName: 'iframe',
								nodeType: 'element',
								attributes: { src: url },
								children: [],
								isVisible: true,
								isInteractive: false,
								isClickable: false,
								isEditable: false,
								isScrollable: false,
								text: `[iframe: ${url}]`,
							},
						});
						continue;
					}

					// Cross-origin: use CDP Target discovery to attach a session
					const iframeTree = await this.extractCrossOriginIframe(cdpSession, url);
					if (iframeTree) {
						iframeTrees.push({
							targetInfo,
							tree: iframeTree,
						});
					}
				} catch (error) {
					logger.debug(`Failed to extract iframe ${frame.url()}: ${error}`);
				}
			}
		} catch (error) {
			logger.debug(`Failed to extract iframe trees: ${error}`);
		}

		return { mainTree, iframeTrees };
	}

	/**
	 * Attach a CDP session to a cross-origin iframe target and extract its DOM tree.
	 * Uses Target.getTargets to find the matching iframe target, then attaches a session
	 * and runs DOMSnapshot.captureSnapshot on it.
	 */
	private async extractCrossOriginIframe(
		cdpSession: CDPSession,
		iframeUrl: string,
	): Promise<PageTreeNode | null> {
		try {
			const { targetInfos } = await cdpSession.send('Target.getTargets', {}) as unknown as {
				targetInfos: Array<{ targetId: string; type: string; url: string; attached: boolean }>;
			};

			const iframeTarget = targetInfos.find(
				(t) => t.type === 'iframe' && t.url === iframeUrl,
			);
			if (!iframeTarget) {
				logger.debug(`No CDP target found for cross-origin iframe: ${iframeUrl}`);
				return null;
			}

			// Attach to the iframe target
			const { sessionId: iframeSessionId } = await cdpSession.send('Target.attachToTarget', {
				targetId: iframeTarget.targetId,
				flatten: true,
			}) as unknown as { sessionId: string };

			try {
				// Capture a DOM snapshot from the iframe session
				const snapshotResult = await cdpSession.send('Target.sendMessageToTarget', {
					sessionId: iframeSessionId,
					message: JSON.stringify({
						id: 1,
						method: 'DOMSnapshot.captureSnapshot',
						params: {
							computedStyles: ['display', 'visibility', 'opacity'],
							includeDOMRects: true,
						},
					}),
				}) as unknown;

				// The snapshot result comes back as a string via Target protocol
				// Build a minimal tree node representing the iframe content
				const iframeNode: PageTreeNode = {
					tagName: 'iframe',
					nodeType: 'element',
					attributes: { src: iframeUrl },
					children: [],
					isVisible: true,
					isInteractive: false,
					isClickable: false,
					isEditable: false,
					isScrollable: false,
					text: `[cross-origin iframe: ${iframeUrl}]`,
				};

				// If snapshot returned usable data, try to annotate the node
				if (snapshotResult && typeof snapshotResult === 'object') {
					iframeNode.text = `[cross-origin iframe content: ${iframeUrl}]`;
				}

				return iframeNode;
			} finally {
				// Detach from the iframe target to clean up
				await cdpSession.send('Target.detachFromTarget', {
					sessionId: iframeSessionId,
				}).catch(() => {});
			}
		} catch (error) {
			logger.debug(`CDP cross-origin iframe extraction failed for ${iframeUrl}: ${error}`);
			return null;
		}
	}

	/**
	 * Collect hints about interactive elements that are off-screen,
	 * including approximate scroll distance.
	 */
	private collectHiddenElementHints(
		root: PageTreeNode,
		viewportSize: { width: number; height: number },
		scrollPosition: { x: number; y: number },
	): string[] {
		const hints: string[] = [];
		const viewportTop = scrollPosition.y;
		const viewportBottom = viewportTop + viewportSize.height;

		const visit = (node: PageTreeNode) => {
			if (
				node.isInteractive &&
				node.rect &&
				!node.isVisible &&
				node.highlightIndex !== undefined
			) {
				const elementY = node.rect.y;
				if (elementY > viewportBottom) {
					const pagesBelow = ((elementY - viewportBottom) / viewportSize.height).toFixed(1);
					const desc = node.ariaLabel || node.text?.trim()?.slice(0, 50) || node.tagName;
					hints.push(
						`${node.tagName} '${desc}' is ~${pagesBelow} pages below`,
					);
				} else if (elementY < viewportTop) {
					const pagesAbove = ((viewportTop - elementY) / viewportSize.height).toFixed(1);
					const desc = node.ariaLabel || node.text?.trim()?.slice(0, 50) || node.tagName;
					hints.push(
						`${node.tagName} '${desc}' is ~${pagesAbove} pages above`,
					);
				}
			}
			for (const child of node.children) {
				visit(child);
			}
		};

		visit(root);
		return hints;
	}

	/**
	 * Apply viewport threshold filtering to the tree.
	 * Interactive elements whose rects fall entirely outside the expanded viewport
	 * have their highlightIndex removed so they are not serialized as interactive.
	 * The expansion margin is controlled by viewportExpansion (in pixels).
	 */
	private applyViewportThresholdFilter(
		root: PageTreeNode,
		viewportSize: { width: number; height: number },
		scrollPosition: { x: number; y: number },
	): void {
		const expansion = this.viewportExpansion;
		const vpTop = scrollPosition.y - expansion;
		const vpBottom = scrollPosition.y + viewportSize.height + expansion;
		const vpLeft = scrollPosition.x - expansion;
		const vpRight = scrollPosition.x + viewportSize.width + expansion;

		const visit = (node: PageTreeNode) => {
			if (node.highlightIndex !== undefined && node.rect) {
