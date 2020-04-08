import { BaseGuard, GuardContext } from './base-guard';
import { Dialog } from 'playwright';

/**
 * Auto-dismisses browser dialogs (alert, confirm, prompt).
 */
export class PopupGuard extends BaseGuard {
  readonly name = 'popups';
  readonly priority = 30;

  private handler: ((dialog: Dialog) => void) | null = null;

  protected async onAttach(ctx: GuardContext): Promise<void> {
    this.handler = async (dialog: Dialog) => {
      this.logger.debug(`Dismissing ${dialog.type()} dialog: "${dialog.message()}"`);
      try {
        await dialog.dismiss();
      } catch {
        // Dialog might already be handled
      }
    };
    ctx.page.on('dialog', this.handler);
  }

  protected async onDetach(): Promise<void> {
    if (this.handler && this.ctx) {
      this.ctx.page.removeListener('dialog', this.handler);
    }
  }
}
