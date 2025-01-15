import type { Dialog } from 'playwright';
import { BaseGuard } from '../guard-base.js';

/**
 * Monitors for default browser actions that need to be handled,
 * such as catching unhandled dialogs and auto-dismissing them.
 */
export class DefaultHandlerGuard extends BaseGuard {
	readonly name = 'default-action';
	readonly priority = 100;

	protected async setup(): Promise<void> {
		const handler = async (dialog: Dialog) => {
			this.ctx.eventBus.emit('popup', {
				url: this.ctx.page.url(),
				type: 'dialog',
			});
			try {
				await dialog.accept();
			} catch {
				// Dialog may already be dismissed
			}
		};

		this.ctx.page.on('dialog', handler);
		this.cleanupFns.push(() => this.ctx.page.off('dialog', handler));
	}
}
