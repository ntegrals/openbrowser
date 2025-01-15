import { BaseGuard } from '../guard-base.js';
import { createLogger } from '../../logging.js';

const logger = createLogger('watchdog:dom');

// ── Options ──

export interface PageReadyGuardOptions {
	/**
	 * Milliseconds of mutation silence required before the DOM is considered
	 * "stable". Defaults to 500 ms.
	 */
	idleTimeoutMs?: number;

	/**
	 * Debounce interval for grouping rapid-fire mutation callbacks.
	 * Defaults to 100 ms.
	 */
	debounceMs?: number;
}

// ── Load-state tracking ──

export type LoadState = 'domcontentloaded' | 'load' | 'networkidle';

// ── Watchdog ──

/**
 * Monitors DOM readiness and mutation activity.
 *
 * Features:
 * - Listens for standard Playwright page lifecycle events
 *   (`domcontentloaded`, `load`, `networkidle`)
 * - Injects a MutationObserver via `page.evaluate` to detect in-page DOM
 *   changes and determine when the page has "settled"
 * - Emits `dom-ready` once the DOM is stable (no mutations for `idleTimeoutMs`)
 * - Exposes `waitForDomStable()` for external consumers
 * - Tracks cumulative mutation count for debugging
 */
export class PageReadyGuard extends BaseGuard {
	readonly name = 'dom';
	readonly priority = 200;

	private readonly idleTimeoutMs: number;
	private readonly debounceMs: number;

	/** Which lifecycle states the current page has reached. */
	private reachedStates = new Set<LoadState>();

	/** Running total of mutation batches observed (useful for debugging). */
	private mutationCount = 0;

	/** Whether we currently consider the DOM to be stable. */
	private stable = false;

	/** Timer handle for the idle-detection window. */
	private idleTimer: ReturnType<typeof setTimeout> | null = null;

	/** Timer handle for the debounce window. */
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Resolvers for external callers waiting on `waitForDomStable`. */
	private stableWaiters: Array<{
		resolve: () => void;
		reject: (err: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}> = [];

	/** Callback used for `page.exposeFunction` – stored so we can reference it. */
	private readonly exposedFnName = '__ob_dom_mutation';

	constructor(options?: PageReadyGuardOptions) {
		super();
		this.idleTimeoutMs = options?.idleTimeoutMs ?? 500;
		this.debounceMs = options?.debounceMs ?? 100;
	}

	// ── Setup ──

	protected async setup(): Promise<void> {
		this.reachedStates.clear();
		this.mutationCount = 0;
		this.stable = false;

		// 1. Standard lifecycle events.
		this.setupLifecycleListeners();

		// 2. MutationObserver bridge via an exposed function.
		await this.setupMutationObserver();

		logger.debug(
			`DOM watchdog active (idleTimeout=${this.idleTimeoutMs}ms, debounce=${this.debounceMs}ms)`,
		);
	}

	// ── Teardown ──

	protected async teardown(): Promise<void> {
		this.clearTimers();

		// Reject pending waiters.
		for (const waiter of this.stableWaiters) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error('PageReadyGuard detached before DOM became stable'));
		}
		this.stableWaiters = [];

		logger.debug(
			`DOM watchdog detached (observed ${this.mutationCount} mutation batches)`,
		);
	}

	// ── Lifecycle listeners ──

	private setupLifecycleListeners(): void {
		const onDomContentLoaded = () => {
			this.reachedStates.add('domcontentloaded');
			logger.debug('Page reached domcontentloaded');
			this.resetIdleTimer();
		};

		const onLoad = () => {
			this.reachedStates.add('load');
			logger.debug('Page reached load');
			this.resetIdleTimer();
		};

		this.ctx.page.on('domcontentloaded', onDomContentLoaded);
		this.ctx.page.on('load', onLoad);

		this.cleanupFns.push(
			() => this.ctx.page.off('domcontentloaded', onDomContentLoaded),
			() => this.ctx.page.off('load', onLoad),
		);

		// `networkidle` is not a standard event – we wait for it asynchronously
		// after page load to avoid blocking setup.
		const watchNetworkIdle = async () => {
			try {
				await this.ctx.page.waitForLoadState('networkidle');
				if (!this.active) return;
				this.reachedStates.add('networkidle');
				logger.debug('Page reached networkidle');
				this.resetIdleTimer();
			} catch {
				// Navigation may have occurred or page closed – ignore.
			}
		};

		// Fire-and-forget; we do not await.
		watchNetworkIdle();
	}

	// ── MutationObserver bridge ──

	private async setupMutationObserver(): Promise<void> {
		// Expose a function so the in-page MutationObserver can call back into Node.
		try {
			await this.ctx.page.exposeFunction(this.exposedFnName, (count: number) => {
				this.onMutationBatch(count);
			});
		} catch {
			// Function may already be exposed from a previous attach cycle.
			logger.debug('Mutation bridge function already exposed – reusing');
		}

		// Inject the observer. We re-inject on every `domcontentloaded` so it
		// survives navigations.
		const injectObserver = async () => {
			try {
				await this.ctx.page.evaluate((fnName: string) => {
					const win = window as unknown as Record<string, unknown>;

					// Avoid double-installing on the same document.
					if (win.__ob_observer_installed) return;
					win.__ob_observer_installed = true;

					let pending = 0;
					const observer = new MutationObserver((mutations) => {
						pending += mutations.length;
					});

					observer.observe(document.documentElement, {
						childList: true,
						subtree: true,
						attributes: true,
						characterData: true,
					});

					// Flush accumulated mutation count periodically rather than on
					// every single micro-mutation.
					setInterval(() => {
						if (pending > 0) {
							const count = pending;
							pending = 0;
							const fn = win[fnName];
							if (typeof fn === 'function') fn(count);
						}
					}, 50);
				}, this.exposedFnName);
			} catch {
				// Page may have navigated away or closed.
			}
		};

		// Inject immediately for the current document...
		await injectObserver();

		// ...and re-inject on future navigations.
		const onDomContentLoaded = () => {
			injectObserver();
		};
		this.ctx.page.on('domcontentloaded', onDomContentLoaded);
		this.cleanupFns.push(() => this.ctx.page.off('domcontentloaded', onDomContentLoaded));
	}

	// ── Mutation handling ──

	private onMutationBatch(count: number): void {
		this.mutationCount += count;
		this.stable = false;

		// Debounce: delay the idle-timer reset so we don't restart it on
		// every single mutation callback.
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.resetIdleTimer();
		}, this.debounceMs);
	}

	// ── Idle detection ──

	private resetIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
		}

		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			this.markStable();
		}, this.idleTimeoutMs);
	}

	private markStable(): void {
		if (this.stable) return;

		this.stable = true;
		logger.debug(
			`DOM stable after ${this.mutationCount} mutation batches ` +
			`(states: ${[...this.reachedStates].join(', ') || 'none'})`,
		);

		this.ctx.eventBus.emit('content-ready', undefined as void);
		this.notifyStableWaiters();
	}

	// ── Public API ──

	/**
	 * Returns a promise that resolves once the DOM is considered stable
	 * (no mutations for `idleTimeoutMs`).
	 *
	 * If the DOM is already stable the promise resolves immediately.
	 *
	 * @param timeout Maximum milliseconds to wait. Defaults to 10 000 ms.
	 */
	waitForDomStable(timeout = 10_000): Promise<void> {
		if (this.stable) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.removeStableWaiter(waiter);
				reject(new Error(`waitForDomStable timed out after ${timeout}ms`));
			}, timeout);

			const waiter = { resolve, reject, timer };
			this.stableWaiters.push(waiter);
		});
	}

	/**
	 * Returns the set of lifecycle states the current page has reached.
	 */
	getReachedStates(): ReadonlySet<LoadState> {
		return this.reachedStates;
	}

	/**
	 * Returns the total number of mutation batches observed since the
	 * watchdog was attached.
	 */
	getMutationCount(): number {
		return this.mutationCount;
	}

	/**
	 * Whether the DOM is currently considered stable.
	 */
	isStable(): boolean {
		return this.stable;
	}

	// ── Waiter helpers ──

	private notifyStableWaiters(): void {
		const waiters = this.stableWaiters.splice(0);
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.resolve();
		}
	}

	private removeStableWaiter(waiter: (typeof this.stableWaiters)[number]): void {
		const idx = this.stableWaiters.indexOf(waiter);
		if (idx !== -1) {
			this.stableWaiters.splice(idx, 1);
		}
	}

	// ── Timer cleanup ──

	private clearTimers(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}
}
