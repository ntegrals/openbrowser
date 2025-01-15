import { BaseGuard } from '../guard-base.js';

/**
 * Handles about:blank pages. If the page navigates to about:blank,
 * attempts to navigate back to the previous page.
 */
export class BlankPageGuard extends BaseGuard {
	readonly name = 'about-blank';
	readonly priority = 400;

	protected async setup(): Promise<void> {
		const handler = () => {
			const url = this.ctx.page.url();
			if (url === 'about:blank') {
				this.ctx.page.goBack().catch(() => {
					// Cannot go back; ignore
				});
			}
		};

		this.ctx.page.on('framenavigated', handler);
		this.cleanupFns.push(() => this.ctx.page.off('framenavigated', handler));
	}
}
