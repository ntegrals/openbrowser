import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CDPSession } from 'playwright';
import { BaseGuard } from '../guard-base.js';
import { createLogger } from '../../logging.js';

const logger = createLogger('watchdog:video-recording');

// ── Options ──

export interface VideoRecordingOptions {
	/** Path for the Playwright trace archive (.zip). */
	outputPath: string;
	/**
	 * Recording mode. `'tracing'` uses Playwright's built-in tracing API
	 * (screenshots + DOM snapshots). `'screencast'` falls back to CDP
	 * Page.startScreencast for raw frame capture. `'auto'` tries tracing
	 * first and falls back to screencast on failure.
	 *
	 * @default 'auto'
	 */
	mode?: 'tracing' | 'screencast' | 'auto';
	/**
	 * Maximum frames per second for CDP screencast mode.
	 * Ignored when using Playwright tracing.
	 *
	 * @default 5
	 */
	maxFrameRate?: number;
	/**
	 * Screencast image format.
	 * @default 'jpeg'
	 */
	format?: 'jpeg' | 'png';
	/**
	 * Screencast image quality (1-100). Only applies to JPEG.
	 * @default 60
	 */
	quality?: number;
	/**
	 * Maximum width of captured screencast frames in pixels.
	 * The browser scales down if the viewport is larger.
	 *
	 * @default 1280
	 */
	maxWidth?: number;
	/**
	 * Maximum height of captured screencast frames in pixels.
	 * @default 720
	 */
	maxHeight?: number;
}

// ── Resolved defaults ──

interface ResolvedOptions {
	outputPath: string;
	mode: 'tracing' | 'screencast' | 'auto';
	maxFrameRate: number;
	format: 'jpeg' | 'png';
	quality: number;
	maxWidth: number;
	maxHeight: number;
}

function resolveOptions(opts: VideoRecordingOptions): ResolvedOptions {
	return {
		outputPath: opts.outputPath,
		mode: opts.mode ?? 'auto',
		maxFrameRate: opts.maxFrameRate ?? 5,
		format: opts.format ?? 'jpeg',
		quality: opts.quality ?? 60,
		maxWidth: opts.maxWidth ?? 1280,
		maxHeight: opts.maxHeight ?? 720,
	};
}

// ── Watchdog ──

/**
 * Records browser activity using Playwright's tracing API or CDP
 * Page.startScreencast as a fallback.
 *
 * - **Tracing mode** captures screenshots and DOM snapshots viewable in
 *   the Playwright Trace Viewer. Produces a `.zip` archive.
 * - **Screencast mode** uses CDP to capture individual frames at a
 *   configurable frame rate and quality. Produces numbered image files
 *   written into a directory alongside the output path.
 *
 * Supports pause/resume so callers can temporarily halt recording
 * (e.g. during long waits) and restart without losing earlier frames.
 */
export class VideoCaptureGuard extends BaseGuard {
	readonly name = 'video-recording';
	readonly priority = 500;

	private readonly options: ResolvedOptions;

	// ── Tracing state ──
	private tracingStarted = false;

	// ── Screencast state ──
	private cdpSession: CDPSession | null = null;
	private screencastActive = false;
	private paused = false;
	private frameCount = 0;
	private readonly frames: Array<{ data: string; timestamp: number }> = [];

	constructor(options: VideoRecordingOptions) {
		super();
		this.options = resolveOptions(options);
	}

	// ── Setup ──

	protected async setup(): Promise<void> {
		const { mode } = this.options;

		if (mode === 'tracing' || mode === 'auto') {
			const tracingOk = await this.startTracing();
			if (tracingOk) return;
			if (mode === 'tracing') {
				logger.warn('Tracing failed and mode is "tracing" – recording will be unavailable');
				return;
			}
			logger.info('Tracing unavailable, falling back to CDP screencast');
		}

		await this.startScreencast();
	}

	// ── Teardown ──

	protected override async teardown(): Promise<void> {
		if (this.tracingStarted) {
			await this.stopTracing();
		} else if (this.screencastActive) {
			await this.stopScreencast();
		}
	}

	// ── Pause / Resume ──

	/**
	 * Temporarily pauses frame capture (screencast only).
	 * Tracing mode does not support granular pause/resume.
	 */
	pause(): void {
		if (!this.screencastActive || this.paused) return;
		this.paused = true;
		logger.debug('Screencast paused');
	}

	/**
	 * Resumes frame capture after a pause (screencast only).
	 */
	resume(): void {
		if (!this.screencastActive || !this.paused) return;
		this.paused = false;
		logger.debug('Screencast resumed');
	}

	/** Whether the recording is currently paused. */
	get isPaused(): boolean {
		return this.paused;
	}

	/** Number of frames captured so far (screencast mode). */
	get capturedFrameCount(): number {
		return this.frameCount;
	}

	// ── Tracing ──

	private async startTracing(): Promise<boolean> {
		try {
			await this.ctx.context.tracing.start({
				screenshots: true,
				snapshots: true,
			});
			this.tracingStarted = true;
			logger.info('Playwright tracing started');
			return true;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			logger.debug(`Could not start tracing: ${reason}`);
			return false;
		}
	}

	private async stopTracing(): Promise<void> {
		try {
			await mkdir(dirname(this.options.outputPath), { recursive: true });
			await this.ctx.context.tracing.stop({
				path: this.options.outputPath,
			});
			logger.info(`Trace saved to ${this.options.outputPath}`);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			logger.error(`Failed to save trace: ${reason}`);
		}
		this.tracingStarted = false;
	}

	// ── Screencast ──

	private async startScreencast(): Promise<void> {
		try {
			this.cdpSession = await this.ctx.page.context().newCDPSession(this.ctx.page);

			this.cdpSession.on('Page.screencastFrame', (params) => {
				const { data, metadata, sessionId } = params as {
					data: string;
					metadata: { timestamp: number };
					sessionId: number;
				};

				// Acknowledge the frame so the browser keeps sending them.
				this.cdpSession?.send('Page.screencastFrameAck', { sessionId }).catch(() => {
					// Ignore ack errors; session may have closed.
				});

				if (this.paused) return;

				this.frameCount++;
				this.frames.push({ data, timestamp: metadata.timestamp });

				if (this.frameCount % 50 === 0) {
					logger.debug(`Screencast: captured ${this.frameCount} frames`);
				}
			});

			await (this.cdpSession.send('Page.startScreencast', {
				format: this.options.format,
				quality: this.options.format === 'jpeg' ? this.options.quality : undefined,
				maxWidth: this.options.maxWidth,
				maxHeight: this.options.maxHeight,
				everyNthFrame: Math.max(1, Math.round(60 / this.options.maxFrameRate)),
			}) as Promise<unknown> as Promise<void>);

			this.screencastActive = true;

			this.cleanupFns.push(() => {
				this.cdpSession?.detach().catch(() => {
					// Ignore detach errors during cleanup.
				});
			});

			logger.info(
				`CDP screencast started (${this.options.maxWidth}x${this.options.maxHeight}, ` +
					`${this.options.format} q${this.options.quality}, ~${this.options.maxFrameRate} fps)`,
			);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			logger.error(`Failed to start CDP screencast: ${reason}`);
		}
	}

	private async stopScreencast(): Promise<void> {
		if (!this.cdpSession) return;

		try {
			await (this.cdpSession.send('Page.stopScreencast') as Promise<unknown> as Promise<void>);
		} catch {
			// Session may already be closed.
		}

		this.screencastActive = false;
		logger.info(`Screencast stopped – ${this.frameCount} frames captured`);

		await this.saveFrames();
	}

	private async saveFrames(): Promise<void> {
		if (this.frames.length === 0) {
			logger.debug('No screencast frames to save');
			return;
		}

		const framesDir = join(dirname(this.options.outputPath), 'screencast-frames');
		await mkdir(framesDir, { recursive: true });

		const ext = this.options.format === 'png' ? 'png' : 'jpg';
		const manifest: Array<{ file: string; timestamp: number }> = [];

		for (let i = 0; i < this.frames.length; i++) {
			const frame = this.frames[i];
			const filename = `frame-${String(i).padStart(5, '0')}.${ext}`;
			const filePath = join(framesDir, filename);
			await writeFile(filePath, Buffer.from(frame.data, 'base64'));
			manifest.push({ file: filename, timestamp: frame.timestamp });
		}

		// Write a JSON manifest alongside the frames for downstream tooling.
		const manifestPath = join(framesDir, 'manifest.json');
		await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

		logger.info(`Saved ${this.frames.length} frames to ${framesDir}`);
	}
}
