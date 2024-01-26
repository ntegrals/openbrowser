import { Page } from 'playwright';
import { createLogger } from '../logging';

const logger = createLogger('visual-tracer');

/**
 * Overlays visual indicators on the page to show what the agent
 * is doing. Useful for debugging and demos.
 */
export class VisualTracer {
  private enabled = false;
  private page: Page | null = null;

  constructor(private readonly options: { color?: string; duration?: number } = {}) {}

  attach(page: Page): void {
    this.page = page;
    this.enabled = true;
    logger.debug('Visual tracer attached');
  }

  detach(): void {
    this.page = null;
    this.enabled = false;
  }

  async highlightElement(selector: string): Promise<void> {
    if (!this.enabled || !this.page) return;

    const color = this.options.color ?? '#FF6B6B';
    const duration = this.options.duration ?? 2000;

    try {
      await this.page.evaluate(
        ({ sel, clr, dur }: { sel: string; clr: string; dur: number }) => {
          const el = document.querySelector(sel);
          if (!el) return;

          const overlay = document.createElement('div');
          const rect = el.getBoundingClientRect();
          Object.assign(overlay.style, {
            position: 'fixed',
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            border: `3px solid ${clr}`,
            borderRadius: '4px',
            pointerEvents: 'none',
            zIndex: '999999',
            transition: 'opacity 0.3s',
          });
          document.body.appendChild(overlay);

          setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
          }, dur);
        },
        { sel: selector, clr: color, dur: duration },
      );
    } catch {
      // Page might have navigated
    }
  }

  async showClickIndicator(x: number, y: number): Promise<void> {
    if (!this.enabled || !this.page) return;

    try {
      await this.page.evaluate(
        ({ px, py }: { px: number; py: number }) => {
          const dot = document.createElement('div');
          Object.assign(dot.style, {
            position: 'fixed',
            left: `${px - 10}px`,
            top: `${py - 10}px`,
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: 'rgba(255, 107, 107, 0.6)',
            pointerEvents: 'none',
            zIndex: '999999',
            transition: 'all 0.5s',
          });
          document.body.appendChild(dot);

          requestAnimationFrame(() => {
            dot.style.transform = 'scale(2)';
            dot.style.opacity = '0';
          });

          setTimeout(() => dot.remove(), 500);
        },
        { px: x, py: y },
      );
    } catch {
      // Ignore
    }
  }
}
