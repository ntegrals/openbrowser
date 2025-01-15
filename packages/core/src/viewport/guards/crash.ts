import { BaseGuard } from '../guard-base.js';

/**
 * Monitors for browser page crashes. Emits crash events
 * and attempts recovery by creating a new page.
 */
export class CrashGuard extends BaseGuard {
	readonly name = 'crash';
	readonly priority = 500;

	protected async setup(): Promise<void> {
		const handler = () => {
			this.ctx.eventBus.emit('crash', {
				reason: 'Page crashed unexpectedly',
			});

			// Attempt recovery by creating a new page
			this.ctx.context
				.newPage()
				.then((newPage) => {
					this.ctx.page = newPage;
				})
				.catch(() => {
					// Recovery failed; context may be closed
				});
		};

		this.ctx.page.on('crash', handler);
		this.cleanupFns.push(() => this.ctx.page.off('crash', handler));
	}
}
