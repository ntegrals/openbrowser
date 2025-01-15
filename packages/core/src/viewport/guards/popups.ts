import type { Page } from 'playwright';
import { BaseGuard } from '../guard-base.js';

/**
 * Monitors for popups and new windows/tabs. Listens for new pages
 * created in the browser context and emits tab-created events.
 */
export class PopupGuard extends BaseGuard {
	readonly name = 'popups';
	readonly priority = 150;

	protected async setup(): Promise<void> {
		const handler = async (page: Page) => {
			try {
				await page.waitForLoadState('domcontentloaded');
			} catch {
				// Page may have been closed before load
			}

			const url = page.url();
			this.ctx.eventBus.emit('tab-opened', { url });

			// Bring focus to the new page
			try {
				await page.bringToFront();
			} catch {
				// Page may have been closed
			}
		};

		this.ctx.context.on('page', handler);
		this.cleanupFns.push(() => this.ctx.context.off('page', handler));
	}
}
