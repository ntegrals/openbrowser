import { BaseGuard } from '../guard-base.js';

/**
 * Ensures a local browser is connected by verifying
 * the page is accessible during setup.
 */
export class LocalInstanceGuard extends BaseGuard {
	readonly name = 'local-browser';
	readonly priority = 10;

	protected async setup(): Promise<void> {
		// Verify the page is accessible by checking its URL.
		// This is a no-op check that throws if the page is not connected.
		this.ctx.page.url();
	}
}
