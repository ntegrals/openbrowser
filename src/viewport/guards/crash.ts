import { BaseGuard, GuardContext } from './base-guard';

/**
 * Monitors for browser crashes and disconnections.
 */
export class CrashGuard extends BaseGuard {
  readonly name = 'crash';
  readonly priority = 10;

  private handler: (() => void) | null = null;

  protected async onAttach(ctx: GuardContext): Promise<void> {
    this.handler = () => {
      this.logger.warn('Page crashed');
      ctx.events.emit('crash', { reason: 'Page crashed' });
    };
    ctx.page.on('crash', this.handler);
  }

  protected async onDetach(): Promise<void> {
    if (this.handler && this.ctx) {
      this.ctx.page.removeListener('crash', this.handler);
    }
  }
}
