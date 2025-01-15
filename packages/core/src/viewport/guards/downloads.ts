import type { Download } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { BaseGuard } from '../guard-base.js';
import { createLogger } from '../../logging.js';

const logger = createLogger('watchdog:downloads');

// ── Options ──

export interface DownloadGuardOptions {
	/** Directory to save downloads to. Defaults to OS temp directory. */
	downloadsPath?: string;
	/** Automatically accept all downloads without prompting. Defaults to true. */
	autoAccept?: boolean;
	/** Settings for PDF printing when a page triggers a print-to-PDF download. */
	pdfSettings?: {
		printBackground: boolean;
		landscape: boolean;
	};
}

// ── Download tracking ──

export type DownloadStatus = 'started' | 'completed' | 'failed';

export interface DownloadInfo {
	url: string;
	suggestedFilename: string;
	savedPath?: string;
	status: DownloadStatus;
	startTime: number;
	endTime?: number;
	fileSize?: number;
}

// ── Watchdog ──

/**
 * Monitors for file downloads with full lifecycle tracking.
 *
 * Features:
 * - Configures CDP download behavior for reliable acceptance
 * - Tracks every download from start to completion/failure
 * - Deduplicates filenames with UUID suffixes when collisions occur
 * - Provides download history and a promise-based wait API
 */
export class DownloadGuard extends BaseGuard {
	readonly name = 'downloads';
	readonly priority = 300;

	private readonly options: Required<DownloadGuardOptions>;
	private readonly downloads = new Map<string, DownloadInfo>();
	private downloadCounter = 0;

	/**
	 * Listeners waiting for the next download to complete.
	 * Each call to `waitForDownload` pushes a resolver here;
	 * it is removed once a download completes or the timeout fires.
	 */
	private pendingWaiters: Array<{
		resolve: (info: DownloadInfo) => void;
		reject: (err: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}> = [];

	constructor(options?: DownloadGuardOptions) {
		super();
		const defaultPath = path.join(
			(typeof process !== 'undefined' && process.env.TMPDIR) || '/tmp',
			'open-browser-downloads',
		);
		this.options = {
			downloadsPath: options?.downloadsPath ?? defaultPath,
			autoAccept: options?.autoAccept ?? true,
			pdfSettings: options?.pdfSettings ?? {
				printBackground: true,
				landscape: false,
			},
		};
	}

	// ── Setup / Teardown ──

	protected async setup(): Promise<void> {
		// Ensure the downloads directory exists.
		this.ensureDownloadsDir();

		// Try to enable CDP-level auto-accept so the browser never shows a
		// "Save As" dialog, even for cross-origin downloads.
		await this.configureCdpDownloadBehavior();

		// Listen for Playwright download events on the page.
		const handler = (download: Download) => {
			this.handleDownload(download).catch((err) => {
				logger.error('Unhandled error processing download', err);
			});
		};

		this.ctx.page.on('download', handler);
		this.cleanupFns.push(() => this.ctx.page.off('download', handler));

		logger.debug(`Downloads watchdog active – saving to ${this.options.downloadsPath}`);
	}

	protected async teardown(): Promise<void> {
		// Reject any pending waiters so they don't hang forever.
		for (const waiter of this.pendingWaiters) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error('DownloadGuard detached before download completed'));
		}
		this.pendingWaiters = [];
		logger.debug('Downloads watchdog detached');
	}

	// ── CDP configuration ──

	private async configureCdpDownloadBehavior(): Promise<void> {
		if (!this.options.autoAccept) return;

		try {
			const cdpSession = await this.ctx.page.context().newCDPSession(this.ctx.page);
			await (cdpSession.send('Page.setDownloadBehavior', {
				behavior: 'allow',
				downloadPath: this.options.downloadsPath,
			}) as Promise<unknown> as Promise<void>);

			this.cleanupFns.push(() => {
				cdpSession.detach().catch(() => {
					// Session may already be closed.
				});
			});

			logger.debug('CDP download behavior set to "allow"');
		} catch (err) {
			// CDP may not be available (e.g. Firefox). Fall back to Playwright-only handling.
			logger.warn('Could not set CDP download behavior – falling back to Playwright handling', err);
		}
	}

	// ── Download handler ──

	private async handleDownload(download: Download): Promise<void> {
		const id = `dl_${++this.downloadCounter}`;
		const suggestedFilename = download.suggestedFilename();
		const url = download.url();

		const info: DownloadInfo = {
			url,
			suggestedFilename,
			status: 'started',
			startTime: Date.now(),
		};
		this.downloads.set(id, info);

		logger.info(`Download started: ${suggestedFilename} (${url})`);

		// Emit the initial event so consumers know a download has begun.
		this.ctx.eventBus.emit('download', {
			url,
			suggestedFilename,
		});

		try {
			const destPath = this.resolveUniquePath(suggestedFilename);

			// Save the file to our chosen path.
			await download.saveAs(destPath);

			// Gather file size.
			let fileSize: number | undefined;
			try {
				const stat = fs.statSync(destPath);
				fileSize = stat.size;
			} catch {
				// File may have been moved/deleted by another process.
			}

			info.savedPath = destPath;
			info.status = 'completed';
			info.endTime = Date.now();
			info.fileSize = fileSize;

			const elapsed = info.endTime - info.startTime;
			logger.info(
				`Download completed: ${suggestedFilename} → ${destPath} (${formatBytes(fileSize)} in ${elapsed}ms)`,
			);

			// Emit a follow-up download event with the saved path.
			this.ctx.eventBus.emit('download', {
				url,
				suggestedFilename,
				path: destPath,
			});

			// Resolve any pending waiters.
			this.notifyWaiters(info);
		} catch (err) {
			info.status = 'failed';
			info.endTime = Date.now();

			const reason = err instanceof Error ? err.message : String(err);
			logger.error(`Download failed: ${suggestedFilename} – ${reason}`);
		}
	}

	// ── Filename collision handling ──

	/**
	 * Returns a path inside the downloads directory. If a file with the same
	 * name already exists, a short UUID is inserted before the extension.
	 */
	private resolveUniquePath(suggestedFilename: string): string {
		const candidate = path.join(this.options.downloadsPath, suggestedFilename);

		if (!fs.existsSync(candidate)) {
			return candidate;
		}

		const ext = path.extname(suggestedFilename);
		const base = path.basename(suggestedFilename, ext);
		const uuid = crypto.randomUUID().slice(0, 8);
		const uniqueName = `${base}-${uuid}${ext}`;

		logger.debug(`File "${suggestedFilename}" already exists – saving as "${uniqueName}"`);
		return path.join(this.options.downloadsPath, uniqueName);
	}

	// ── Directory helpers ──

	private ensureDownloadsDir(): void {
		if (!fs.existsSync(this.options.downloadsPath)) {
			fs.mkdirSync(this.options.downloadsPath, { recursive: true });
			logger.debug(`Created downloads directory: ${this.options.downloadsPath}`);
		}
	}

	// ── Public API ──

	/**
	 * Returns a snapshot of all tracked downloads (both in-progress and finished).
	 */
	getDownloadHistory(): DownloadInfo[] {
		return Array.from(this.downloads.values());
	}

	/**
	 * Returns a promise that resolves with the `DownloadInfo` of the next
	 * download that completes (or rejects after `timeout` ms).
	 *
	 * @param timeout Maximum milliseconds to wait. Defaults to 30 000 ms.
	 */
	waitForDownload(timeout = 30_000): Promise<DownloadInfo> {
		return new Promise<DownloadInfo>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.removePendingWaiter(waiter);
				reject(new Error(`waitForDownload timed out after ${timeout}ms`));
			}, timeout);

			const waiter = { resolve, reject, timer };
			this.pendingWaiters.push(waiter);
		});
	}

	// ── Waiter helpers ──

	private notifyWaiters(info: DownloadInfo): void {
		const waiters = this.pendingWaiters.splice(0);
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.resolve(info);
		}
	}

	private removePendingWaiter(waiter: (typeof this.pendingWaiters)[number]): void {
		const idx = this.pendingWaiters.indexOf(waiter);
		if (idx !== -1) {
			this.pendingWaiters.splice(idx, 1);
		}
	}
}

// ── Helpers ──

function formatBytes(bytes: number | undefined): string {
	if (bytes == null) return '? bytes';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
