import { BaseGuard, GuardContext } from './base-guard';

/**
 * Manages automatic screenshot capture on errors or at intervals.
 */
export class ScreenshotGuard extends BaseGuard {
  readonly name = 'screenshot';
  readonly priority = 60;

  protected async onAttach(ctx: GuardContext): Promise<void> {
    // Auto-screenshot on page errors
    ctx.page.on('pageerror', async () => {
      try {
        const buffer = await ctx.page.screenshot({ type: 'png' });
        ctx.events.emit('auto-screenshot', { buffer, reason: 'page-error' });
      } catch {
        // Page might be gone
      }
    });
  }

  protected async onDetach(): Promise<void> {}
}
