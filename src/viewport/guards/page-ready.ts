import { BaseGuard, GuardContext } from './base-guard';

/**
 * Emits page-ready event when page finishes loading.
 */
export class PageReadyGuard extends BaseGuard {
  readonly name = 'page-ready';
  readonly priority = 40;

  protected async onAttach(ctx: GuardContext): Promise<void> {
    ctx.page.on('load', () => {
      const url = ctx.page.url();
      if (url !== 'about:blank') {
        this.logger.debug(`Page ready: ${url}`);
        ctx.events.emit('page-ready', { url });
      }
    });
  }

  protected async onDetach(): Promise<void> {}
}
