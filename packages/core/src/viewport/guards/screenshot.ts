import type { ScreenshotEvent, ScreenshotResult } from '../events.js';
import { BaseGuard } from '../guard-base.js';

/**
 * Handles screenshot requests by registering a request handler
 * for 'get-screenshot' on the event bus.
 */
export class ScreenshotGuard extends BaseGuard {
	readonly name = 'screenshot';
	readonly priority = 700;

	protected async setup(): Promise<void> {
		const off = this.ctx.eventBus.onRequest(
			'get-screenshot',
			async (event: ScreenshotEvent): Promise<ScreenshotResult> => {
				const buffer = await this.ctx.page.screenshot({
					fullPage: event?.fullPage ?? false,
					type: 'png',
				});

				const base64 = buffer.toString('base64');
				const viewport = this.ctx.page.viewportSize();

				return {
					base64,
					width: viewport?.width ?? 0,
					height: viewport?.height ?? 0,
				};
			},
		);

		this.cleanupFns.push(off);
	}
}
