import { BaseGuard, GuardContext } from './base-guard';

/**
 * Enforces URL allowlist/blocklist policies.
 */
export class UrlPolicyGuard extends BaseGuard {
  readonly name = 'url-policy';
  readonly priority = 20;

  private allowedUrls?: string[];
  private blockedUrls?: string[];

  constructor(allowedUrls?: string[], blockedUrls?: string[]) {
    super();
    this.allowedUrls = allowedUrls;
    this.blockedUrls = blockedUrls;
  }

  protected async onAttach(ctx: GuardContext): Promise<void> {
    // Check URL on each navigation
    ctx.page.on('framenavigated', async (frame) => {
      if (frame !== ctx.page.mainFrame()) return;
      const url = frame.url();
      if (!this.isAllowed(url)) {
        this.logger.warn(`Blocked navigation to: ${url}`);
        ctx.events.emit('url-blocked', { url });
      }
    });
  }

  protected async onDetach(): Promise<void> {
    // Playwright doesn't easily allow removing specific frame listeners
  }

  private isAllowed(url: string): boolean {
    if (url === 'about:blank') return true;
    if (this.blockedUrls) {
      for (const pattern of this.blockedUrls) {
        if (url.includes(pattern)) return false;
      }
    }
    if (this.allowedUrls && this.allowedUrls.length > 0) {
      return this.allowedUrls.some(pattern => url.includes(pattern));
    }
    return true;
  }
}
