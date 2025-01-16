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
