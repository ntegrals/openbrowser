import type { Page, BrowserContext } from 'playwright';
import type { EventHub } from './event-hub.js';
import type { ViewportEventMap, ViewportRequestMap } from './events.js';

export interface GuardContext {
	page: Page;
	context: BrowserContext;
	eventBus: EventHub<ViewportEventMap, ViewportRequestMap>;
}

/**
 * Base class for browser watchdogs that monitor and react to browser events.
 * Each watchdog handles a specific concern (security, popups, downloads, etc.).
 */
export abstract class BaseGuard {
	protected ctx!: GuardContext;
	protected cleanupFns: Array<() => void> = [];
	private _active = false;

	get active(): boolean {
		return this._active;
	}

	abstract readonly name: string;
	abstract readonly priority: number;

	async attach(ctx: GuardContext): Promise<void> {
		this.ctx = ctx;
		this._active = true;
		await this.setup();
	}

	async detach(): Promise<void> {
		this._active = false;
		for (const cleanup of this.cleanupFns) {
			try {
				cleanup();
			} catch {
				// Ignore cleanup errors
			}
		}
		this.cleanupFns = [];
		await this.teardown();
	}

	protected abstract setup(): Promise<void>;

	protected async teardown(): Promise<void> {
		// Override if needed
	}

	protected onEvent<K extends keyof ViewportEventMap & string>(
		event: K,
		handler: (payload: ViewportEventMap[K]) => void,
	): void {
		const off = this.ctx.eventBus.on(event, handler);
		this.cleanupFns.push(off);
	}
}
