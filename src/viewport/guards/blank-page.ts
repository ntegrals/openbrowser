import { BaseGuard, GuardContext } from './base-guard';

/**
 * Detects when the page is blank (about:blank) and emits an event.
 */
export class BlankPageGuard extends BaseGuard {
  readonly name = 'blank-page';
  readonly priority = 50;

  private checkInterval: NodeJS.Timer | null = null;

  protected async onAttach(ctx: GuardContext): Promise<void> {
    this.checkInterval = setInterval(async () => {
      try {
        const url = ctx.page.url();
        if (url === 'about:blank' || url === '') {
          this.logger.debug('Blank page detected');
          ctx.events.emit('blank-page', { url });
        }
      } catch {
        // Page might be navigating
      }
    }, 2000);
  }

  protected async onDetach(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
