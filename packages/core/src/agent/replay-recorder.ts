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
