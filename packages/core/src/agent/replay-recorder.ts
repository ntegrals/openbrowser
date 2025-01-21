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
		} catch {
			throw new Error(
				'sharp is not installed. Install it with: npm install sharp',
			);
		}

		// Resolve the default export (handles both ESM and CJS)
		const sharp = sharpModule.default ?? sharpModule;

		const gifPath = outputPath.replace(/\.[^.]+$/, '.gif');
		const processedFrames: Buffer[] = [];

		for (const frame of this.frames) {
			let img = sharp(frame.buffer);

			// Resize if configured
			if (this.resizeWidth > 0) {
				img = img.resize(this.resizeWidth, undefined, {
					fit: 'inside',
					withoutEnlargement: true,
				});
			}

			// Composite a step number overlay onto the frame
			const overlayBuffer = this.createStepOverlaySvg(
				frame.stepNumber,
				frame.label,
			);

			img = img.composite([
				{
					input: Buffer.from(overlayBuffer),
					gravity: 'northwest',
				},
			]);

			// Convert to PNG for further processing
			const processed = await img
				.flatten({ background: { r: 255, g: 255, b: 255 } })
				.png()
				.toBuffer();

			processedFrames.push(processed);
		}

		// Attempt to assemble an animated GIF from the processed frames
		try {
			const firstFrame = sharp(processedFrames[0]);
			const metadata = await firstFrame.metadata();
			const width = metadata.width ?? this.resizeWidth;
			const height = metadata.height ?? 600;

			// Convert each frame to raw RGBA
			const rawFrames: Buffer[] = [];
			for (const frameBuffer of processedFrames) {
				const raw = await sharp(frameBuffer)
					.resize(width, height, {
						fit: 'contain',
						background: { r: 255, g: 255, b: 255 },
					})
					.raw()
					.ensureAlpha()
					.toBuffer();
				rawFrames.push(raw);
			}

			// Concatenate all raw frames and encode as animated GIF
			const combinedRaw = Buffer.concat(rawFrames);
			await sharp(combinedRaw, {
				raw: {
					width,
					height,
					channels: 4,
					pages: rawFrames.length,
				},
			})
				.gif({
					delay: Array(rawFrames.length).fill(this.frameDelay),
					loop: 0,
				})
				.toFile(gifPath);

			return gifPath;
		} catch (animatedError) {
			// If animated GIF creation fails, save the last frame as a static image
			logger.debug(
				`Animated GIF assembly failed, saving static image: ${
					animatedError instanceof Error
						? animatedError.message
						: String(animatedError)
				}`,
			);
			const lastFrame = processedFrames[processedFrames.length - 1];
			const staticPath = outputPath.replace(/\.[^.]+$/, '.png');
			await sharp(lastFrame).png().toFile(staticPath);
			return staticPath;
		}
	}

	/**
	 * Create an SVG overlay with the step number and optional label.
	 * Returns an SVG string that can be composited onto the frame.
	 */
	private createStepOverlaySvg(stepNumber: number, label?: string): string {
		const labelText = label ? ` - ${label.slice(0, 40)}` : '';
		const text = `Step ${stepNumber}${labelText}`;
		const width = Math.max(200, text.length * 10 + 20);
		const height = 36;

		return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<rect x="0" y="0" width="${width}" height="${height}" rx="4" fill="rgba(0,0,0,0.7)"/>
			<text x="10" y="24" font-family="monospace" font-size="16" fill="white">${this.escapeXml(text)}</text>
		</svg>`;
	}

	/**
	 * Save individual PNG frames to a directory alongside the output path.
	 */
	private async saveFrames(outputPath: string): Promise<string> {
		const framesDir = outputPath.replace(/\.[^.]+$/, '_frames');
