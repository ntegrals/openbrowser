import { Page, BrowserContext } from 'playwright';
import { EventHub } from '../event-hub';
import { createLogger } from '../logging';

export interface GuardContext {
  page: Page;
  context: BrowserContext;
  events: EventHub;
}

/**
 * Base class for viewport guards. Guards watch for specific conditions
 * and react to them (e.g., handling popups, crashes, blank pages).
 */
export abstract class BaseGuard {
  abstract readonly name: string;
  abstract readonly priority: number;

  protected logger = createLogger('guard');
  protected ctx: GuardContext | null = null;

  async attach(ctx: GuardContext): Promise<void> {
    this.ctx = ctx;
    this.logger = createLogger(`guard:${this.name}`);
    await this.onAttach(ctx);
  }

  async detach(): Promise<void> {
    if (this.ctx) {
      await this.onDetach();
      this.ctx = null;
    }
  }

  protected abstract onAttach(ctx: GuardContext): Promise<void>;
  protected abstract onDetach(): Promise<void>;
}
