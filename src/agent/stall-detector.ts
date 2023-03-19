import { createLogger } from '../logging';

const logger = createLogger('stall-detector');

/**
 * Detects when the agent is stuck in a loop, performing the
 * same action repeatedly without making progress.
 */
export class StallDetector {
  private recentActions: string[] = [];
  private readonly windowSize: number;
  private readonly threshold: number;

  constructor(options: { windowSize?: number; threshold?: number } = {}) {
    this.windowSize = options.windowSize ?? 5;
    this.threshold = options.threshold ?? 3;
  }

  /**
   * Record an action and check if we're stalling.
   * Returns true if the agent appears stuck.
   */
  recordAction(action: string): boolean {
    this.recentActions.push(action);

    // Keep only the last N actions
    if (this.recentActions.length > this.windowSize) {
      this.recentActions = this.recentActions.slice(-this.windowSize);
    }

    return this.isStalled();
  }

  /**
   * Check if the last N actions are all the same.
   */
  isStalled(): boolean {
    if (this.recentActions.length < this.threshold) return false;

    const recent = this.recentActions.slice(-this.threshold);
    const allSame = recent.every(a => a === recent[0]);

    if (allSame) {
      logger.warn(`Stall detected: "${recent[0]}" repeated ${this.threshold} times`);
    }

    return allSame;
  }

  reset(): void {
    this.recentActions = [];
  }
}
