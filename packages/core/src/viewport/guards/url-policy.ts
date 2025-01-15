import type { Route } from 'playwright';
import { BaseGuard } from '../guard-base.js';
import { isUrlPermitted } from '../../utils.js';

/**
 * Monitors for security concerns by intercepting navigation requests.
 * Checks URLs against allowed/blocked lists before permitting navigation.
 */
export class UrlPolicyGuard extends BaseGuard {
	readonly name = 'policy-violation';
	readonly priority = 50;

	private readonly allowedUrls: string[];
	private readonly blockedUrls: string[];

	constructor(allowedUrls: string[] = [], blockedUrls: string[] = []) {
		super();
		this.allowedUrls = allowedUrls;
		this.blockedUrls = blockedUrls;
	}

	protected async setup(): Promise<void> {
		const handler = async (route: Route) => {
			const url = route.request().url();

			if (
				route.request().isNavigationRequest() &&
				!isUrlPermitted(url, this.allowedUrls, this.blockedUrls)
			) {
				this.ctx.eventBus.emit('policy-violation', {
					type: 'navigation-blocked',
					url,
					reason: `URL not allowed by security policy: ${url}`,
				});
				await route.abort('blockedbyclient');
				return;
			}

			await route.continue();
		};

		await this.ctx.page.route('**/*', handler);
		this.cleanupFns.push(() => {
			this.ctx.page.unroute('**/*', handler).catch(() => {
				// Ignore errors during cleanup
			});
		});
	}
}
