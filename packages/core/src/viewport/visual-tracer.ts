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
				selector,
				color: this.options.highlightColor,
				duration: this.options.highlightDuration,
				label,
				fontSize: this.options.annotationFontSize,
				attr: OVERLAY_ATTR,
			},
		);
	}

	async showAction(page: Page, action: string, details?: string): Promise<void> {
		await page.evaluate(
			({ action, details, fontSize, attr }) => {
				const toast = document.createElement('div');
				toast.setAttribute(attr, '');
				toast.style.cssText = `
					position: fixed;
					bottom: 20px;
					right: 20px;
					background: rgba(0, 0, 0, 0.8);
					color: white;
					padding: 12px 20px;
					border-radius: 8px;
					font-family: monospace;
					font-size: ${fontSize}px;
					z-index: 999999;
					max-width: 400px;
					transition: opacity 0.3s;
				`;
				toast.innerHTML = `<strong>${action}</strong>${details ? `<br>${details}` : ''}`;

				document.body.appendChild(toast);
				setTimeout(() => {
					toast.style.opacity = '0';
					setTimeout(() => toast.remove(), 300);
				}, 2000);
			},
			{ action, details, fontSize: this.options.annotationFontSize, attr: OVERLAY_ATTR },
		);
	}

	// ───────────────────────────────────────────
	// Action-specific visual overlays
	// ───────────────────────────────────────────

	/**
	 * Shows an expanding circle animation at the given click coordinates.
	 * Optionally displays a label next to the click point.
	 */
	async highlightClick(page: Page, x: number, y: number, label?: string): Promise<void> {
		await page.evaluate(
			({ x, y, label, color, duration, fontSize, attr }) => {
				const container = document.createElement('div');
				container.setAttribute(attr, '');
				container.style.cssText = `
					position: fixed;
					left: 0;
					top: 0;
					width: 100%;
					height: 100%;
					pointer-events: none;
					z-index: 999999;
				`;

				// Inject keyframes for the expanding ring
				const styleEl = document.createElement('style');
				styleEl.textContent = `
					@keyframes demo-click-ring {
						0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
						70% { opacity: 0.6; }
						100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
					}
				`;
				container.appendChild(styleEl);

				// Create three staggered rings for a ripple effect
				for (let i = 0; i < 3; i++) {
					const ring = document.createElement('div');
					ring.style.cssText = `
						position: fixed;
						left: ${x}px;
						top: ${y}px;
						width: 60px;
						height: 60px;
						border: 3px solid ${color};
						border-radius: 50%;
						pointer-events: none;
						animation: demo-click-ring ${duration * 0.6}ms ease-out ${i * 120}ms forwards;
					`;
					container.appendChild(ring);
				}

				// Small filled dot at click center
				const dot = document.createElement('div');
				dot.style.cssText = `
					position: fixed;
					left: ${x}px;
					top: ${y}px;
					width: 10px;
					height: 10px;
					background: ${color};
					border-radius: 50%;
					transform: translate(-50%, -50%);
					pointer-events: none;
					transition: opacity 0.3s;
				`;
				container.appendChild(dot);

				// Optional label
				if (label) {
					const labelEl = document.createElement('div');
					labelEl.textContent = label;
					labelEl.style.cssText = `
						position: fixed;
						left: ${x + 16}px;
						top: ${y - 12}px;
						background: ${color};
						color: white;
						padding: 2px 8px;
						font-size: ${fontSize}px;
						font-family: monospace;
						border-radius: 3px;
						white-space: nowrap;
						pointer-events: none;
					`;
					container.appendChild(labelEl);
				}

				document.body.appendChild(container);
				setTimeout(() => {
					container.style.opacity = '0';
					setTimeout(() => container.remove(), 300);
				}, duration);
			},
			{
				x,
				y,
				label,
				color: this.options.actionColors.click,
				duration: this.options.highlightDuration,
				fontSize: this.options.annotationFontSize,
				attr: OVERLAY_ATTR,
			},
		);
	}

	/**
	 * Shows an arrow animation indicating the scroll direction.
	 */
	async highlightScroll(page: Page, direction: 'up' | 'down'): Promise<void> {
		await page.evaluate(
			({ direction, color, duration, fontSize, attr }) => {
				const container = document.createElement('div');
				container.setAttribute(attr, '');
				container.style.cssText = `
					position: fixed;
					left: 0;
					top: 0;
					width: 100%;
					height: 100%;
					pointer-events: none;
					z-index: 999999;
				`;

				const styleEl = document.createElement('style');
				const translateY = direction === 'up' ? '-40px' : '40px';
				styleEl.textContent = `
					@keyframes demo-scroll-arrow {
						0% { opacity: 0; transform: translateX(-50%) translateY(0); }
						30% { opacity: 1; }
						100% { opacity: 0; transform: translateX(-50%) translateY(${translateY}); }
					}
				`;
				container.appendChild(styleEl);

				const arrowChar = direction === 'up' ? '\u25B2' : '\u25BC';

				// Show three staggered arrows along the right side
				for (let i = 0; i < 3; i++) {
					const arrow = document.createElement('div');
					const topOffset = direction === 'up' ? 60 + i * 40 : 40 + i * 40;
					arrow.textContent = arrowChar;
					arrow.style.cssText = `
						position: fixed;
						right: 30px;
						top: ${topOffset}%;
						transform: translateX(-50%);
						color: ${color};
						font-size: ${fontSize * 2}px;
						pointer-events: none;
						animation: demo-scroll-arrow ${duration * 0.5}ms ease-out ${i * 150}ms forwards;
					`;
					container.appendChild(arrow);
				}

				// Direction label
				const label = document.createElement('div');
				label.textContent = `Scroll ${direction}`;
				label.style.cssText = `
					position: fixed;
					right: 12px;
					top: 50%;
					transform: translateY(-50%);
					background: ${color};
					color: white;
					padding: 4px 12px;
					font-size: ${fontSize}px;
					font-family: monospace;
					border-radius: 4px;
					pointer-events: none;
					transition: opacity 0.3s;
				`;
				container.appendChild(label);

				document.body.appendChild(container);
				setTimeout(() => {
					container.style.opacity = '0';
					setTimeout(() => container.remove(), 300);
				}, duration);
			},
			{
				direction,
				color: this.options.actionColors.scroll,
				duration: this.options.highlightDuration,
				fontSize: this.options.annotationFontSize,
				attr: OVERLAY_ATTR,
			},
		);
	}

	/**
	 * Shows a keyboard icon animation near the target element with a preview of the text being typed.
	 */
	async highlightType(page: Page, selector: string, text: string): Promise<void> {
		await page.evaluate(
			({ selector, text, color, duration, fontSize, attr }) => {
				const element = document.querySelector(selector);
				if (!element) return;

				const rect = element.getBoundingClientRect();

				const container = document.createElement('div');
				container.setAttribute(attr, '');
				container.style.cssText = `
					position: fixed;
					left: 0;
					top: 0;
					width: 100%;
					height: 100%;
					pointer-events: none;
					z-index: 999999;
				`;

				const styleEl = document.createElement('style');
				styleEl.textContent = `
					@keyframes demo-type-blink {
						0%, 100% { border-right-color: transparent; }
						50% { border-right-color: white; }
					}
					@keyframes demo-type-fadein {
						0% { opacity: 0; transform: translateY(4px); }
						100% { opacity: 1; transform: translateY(0); }
					}
				`;
				container.appendChild(styleEl);

				// Highlight the target element
				const highlight = document.createElement('div');
				highlight.style.cssText = `
					position: fixed;
					left: ${rect.left - 2}px;
					top: ${rect.top - 2}px;
					width: ${rect.width + 4}px;
					height: ${rect.height + 4}px;
					border: 2px solid ${color};
					border-radius: 3px;
					pointer-events: none;
					transition: opacity 0.3s;
				`;
				container.appendChild(highlight);

				// Keyboard icon (simplified as a unicode symbol + label)
				const kbIcon = document.createElement('div');
				kbIcon.style.cssText = `
					position: fixed;
					left: ${rect.left}px;
					top: ${rect.bottom + 6}px;
					display: flex;
					align-items: center;
					gap: 6px;
					animation: demo-type-fadein 0.2s ease-out forwards;
					pointer-events: none;
				`;

				const iconSpan = document.createElement('span');
				iconSpan.textContent = '\u2328';
				iconSpan.style.cssText = `
					font-size: ${fontSize * 1.4}px;
					color: ${color};
				`;
				kbIcon.appendChild(iconSpan);

				// Text preview bubble with blinking cursor
				const textBubble = document.createElement('div');
				const truncated = text.length > 40 ? `${text.slice(0, 37)}...` : text;
				textBubble.textContent = truncated;
				textBubble.style.cssText = `
					background: ${color};
					color: white;
					padding: 3px 10px;
					font-size: ${fontSize}px;
					font-family: monospace;
					border-radius: 4px;
					white-space: nowrap;
					border-right: 2px solid white;
