import { createLogger } from '../logging';
import type { UsageRecord, UsageSnapshot } from './types';

const logger = createLogger('usage-meter');

/**
 * Tracks usage metrics across browser sessions.
 */
export class UsageMeter {
  private total: UsageRecord;
  private session: UsageRecord;

  constructor() {
    const now = Date.now();
    this.total = { commands: 0, navigations: 0, screenshots: 0, startTime: now, duration: 0 };
    this.session = { commands: 0, navigations: 0, screenshots: 0, startTime: now, duration: 0 };
  }

  recordCommand(): void {
    this.total.commands++;
    this.session.commands++;
  }

  recordNavigation(): void {
    this.total.navigations++;
    this.session.navigations++;
  }

  recordScreenshot(): void {
    this.total.screenshots++;
    this.session.screenshots++;
  }

  getSnapshot(): UsageSnapshot {
    const now = Date.now();
    return {
      total: { ...this.total, duration: now - this.total.startTime },
      session: { ...this.session, duration: now - this.session.startTime },
    };
  }

  resetSession(): void {
    this.session = {
      commands: 0,
      navigations: 0,
      screenshots: 0,
      startTime: Date.now(),
      duration: 0,
    };
  }
}
