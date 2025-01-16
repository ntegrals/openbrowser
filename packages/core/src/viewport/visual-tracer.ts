import type { Page } from 'playwright';

export interface VisualTracerOptions {
	highlightColor?: string;
	highlightDuration?: number;
	annotationFontSize?: number;
	showTimeline?: boolean;
	showCoordinates?: boolean;
	actionColors?: Record<string, string>;
}

const DEFAULT_OPTIONS: Required<VisualTracerOptions> = {
	highlightColor: 'rgba(255, 0, 0, 0.3)',
	highlightDuration: 2000,
	annotationFontSize: 14,
	showTimeline: false,
	showCoordinates: false,
	actionColors: {
		click: '#ff4444',
		scroll: '#44aaff',
		type: '#44cc44',
		navigate: '#ff9900',
		default: '#aa44ff',
	},
};

const OVERLAY_ATTR = 'data-demo-mode-overlay';

export class VisualTracer {
	private options: Required<VisualTracerOptions>;

	constructor(options?: VisualTracerOptions) {
		this.options = {
			...DEFAULT_OPTIONS,
			...options,
			actionColors: { ...DEFAULT_OPTIONS.actionColors, ...options?.actionColors },
		};
	}

	// ───────────────────────────────────────────
	// Existing methods
	// ───────────────────────────────────────────

	async highlightElement(page: Page, selector: string, label?: string): Promise<void> {
		await page.evaluate(
			({ selector, color, duration, label, fontSize, attr }) => {
				const element = document.querySelector(selector);
				if (!element) return;

				const rect = element.getBoundingClientRect();
				const overlay = document.createElement('div');
				overlay.setAttribute(attr, '');
				overlay.style.cssText = `
					position: fixed;
					left: ${rect.left}px;
					top: ${rect.top}px;
					width: ${rect.width}px;
					height: ${rect.height}px;
					background: ${color};
					border: 2px solid red;
					pointer-events: none;
					z-index: 999999;
					transition: opacity 0.3s;
				`;

				if (label) {
					const labelEl = document.createElement('div');
					labelEl.textContent = label;
					labelEl.style.cssText = `
						position: absolute;
						top: -24px;
						left: 0;
						background: red;
						color: white;
						padding: 2px 6px;
						font-size: ${fontSize}px;
						font-family: monospace;
						border-radius: 3px;
						white-space: nowrap;
					`;
					overlay.appendChild(labelEl);
				}

				document.body.appendChild(overlay);
				setTimeout(() => {
					overlay.style.opacity = '0';
					setTimeout(() => overlay.remove(), 300);
				}, duration);
			},
			{
