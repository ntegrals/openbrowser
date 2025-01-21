import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../logging.js';

const logger = createLogger('gif-recorder');

export interface ReplayRecorderOptions {
	/** Output file path. Extension determines format (.gif or .png for fallback). */
	outputPath: string;
	/** Delay between frames in milliseconds */
	frameDelay?: number;
	/** Resize frames to this width (maintains aspect ratio). 0 = no resize. */
	resizeWidth?: number;
	/** Quality (1-30, lower = better quality). Only used for GIF encoding. */
	quality?: number;
}

interface FrameData {
	buffer: Buffer;
	stepNumber: number;
	label?: string;
}

/**
 * Records agent screenshots and encodes them into an animated GIF.
 *
 * Uses the `sharp` library (optional dependency) for image processing
 * and compositing step-number overlays. If sharp is not available,
 * falls back to saving individual PNG frames.
 *
 * Usage:
 *   const recorder = new ReplayRecorder({ outputPath: './recording.gif' });
 *   recorder.addFrame(screenshotBase64, 1);
 *   // ... more frames ...
 *   await recorder.save(); // -> path to GIF or frames directory
 */
export class ReplayRecorder {
	private frames: FrameData[] = [];
	private outputPath: string;
	private frameDelay: number;
	private resizeWidth: number;
	private quality: number;

	constructor(options: ReplayRecorderOptions) {
		this.outputPath = options.outputPath;
		this.frameDelay = options.frameDelay ?? 500;
		this.resizeWidth = options.resizeWidth ?? 800;
		this.quality = options.quality ?? 10;
	}

	/**
	 * Add a screenshot frame to the recording.
	 * @param screenshotBase64 - PNG screenshot as base64 string
	 * @param stepNumber - Step number for the overlay annotation
	 * @param label - Optional label text (e.g., the action taken)
	 */
	addFrame(screenshotBase64: string, stepNumber?: number, label?: string): void {
		const buffer = Buffer.from(screenshotBase64, 'base64');
		this.frames.push({
			buffer,
			stepNumber: stepNumber ?? this.frames.length + 1,
			label,
		});
	}

	/**
	 * Save the recording. Attempts GIF encoding with sharp, falls back
	 * to individual PNG frames if sharp is not available.
	 *
	 * @param generateGif - true to generate a GIF, 'path' to override output path,
	 *                      false to only save individual frames
	 * @returns The path where the recording was saved
	 */
	async save(generateGif: string | boolean = true): Promise<string> {
		if (this.frames.length === 0) {
			logger.debug('No frames to save');
			return this.outputPath;
		}

		const effectivePath = typeof generateGif === 'string' ? generateGif : this.outputPath;
		const dir = path.dirname(effectivePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		// Always save individual frames as fallback / debug
		await this.saveFrames(effectivePath);

		if (generateGif === false) {
			return effectivePath;
		}

		// Try to generate actual GIF using sharp
		try {
			const gifPath = await this.encodeGif(effectivePath);
			logger.info(`GIF saved: ${gifPath} (${this.frames.length} frames)`);
			return gifPath;
		} catch (error) {
			logger.warn(
				`GIF encoding failed, falling back to individual frames: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return effectivePath;
		}
	}

	/**
	 * Encode frames into an animated GIF using sharp.
	 * Sharp must be installed as a peer dependency.
	 */
	private async encodeGif(outputPath: string): Promise<string> {
		// Dynamic import -- sharp is an optional dependency.
		// Use indirect require to avoid TS module resolution error.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let sharpModule: any;
		try {
			// Indirect dynamic import avoids TS2307 for optional peer deps
			const moduleName = 'sharp';
			sharpModule = await import(/* webpackIgnore: true */ moduleName);
