import type { CDPSession } from 'playwright';
import { BaseGuard } from '../guard-base.js';

/**
 * Grants browser permissions (geolocation, notifications, camera, etc.)
 * via CDP. Re-grants permissions when the page navigates to a new origin.
 */
export class PermissionsGuard extends BaseGuard {
	readonly name = 'permissions';
	readonly priority = 400;

	private readonly permissions: string[];
	private cdpSession: CDPSession | null = null;
	private lastOrigin: string | null = null;

	constructor(permissions: string[]) {
		super();
		this.permissions = permissions;
	}

	protected async setup(): Promise<void> {
		this.cdpSession = await this.ctx.page.context().newCDPSession(this.ctx.page);

		// Grant permissions for the current page origin
		await this.grantForCurrentPage();

		// Re-grant permissions when navigating to a new origin
		const handler = () => {
			this.grantForCurrentPage().catch(() => {
				// Ignore errors from navigations to about:blank, etc.
			});
		};

		this.ctx.page.on('framenavigated', handler);
		this.cleanupFns.push(() => this.ctx.page.off('framenavigated', handler));
		this.cleanupFns.push(() => {
			this.cdpSession?.detach().catch(() => {
				// Ignore detach errors during cleanup
			});
		});
	}

	private async grantForCurrentPage(): Promise<void> {
		const url = this.ctx.page.url();
		let origin: string;
		try {
			origin = new URL(url).origin;
		} catch {
			return;
		}

		// Skip non-http origins and avoid re-granting for the same origin
		if (!origin.startsWith('http') || origin === this.lastOrigin) return;

		this.lastOrigin = origin;
		if (!this.cdpSession) return;
		// CDP types require PermissionType[] but we accept string[] for ergonomics
		type SendFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;
		await (this.cdpSession.send as unknown as SendFn)(
			'Browser.grantPermissions',
			{ permissions: this.permissions, origin },
		);
	}
}
