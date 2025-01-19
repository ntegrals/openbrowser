import type { Command } from '../commands/types.js';

// ── Enhanced Page Fingerprint ──

export interface PageSignature {
	url: string;
	domHash: string;
	scrollY: number;
	elementCount?: number;
	textHash?: string;
}

export interface StallDetectorConfig {
	maxRepeatedActions: number;
	maxRepeatedFingerprints: number;
	windowSize: number;
	/** Number of consecutive stagnant pages before raising stall alert */
	maxStagnantPages: number;
}

const DEFAULT_OPTIONS: StallDetectorConfig = {
	maxRepeatedActions: 3,
	maxRepeatedFingerprints: 3,
	windowSize: 10,
	maxStagnantPages: 5,
};

export interface StallCheckResult {
	stuck: boolean;
	reason?: string;
	/** Escalation level: 0 = not stuck, 1 = mild, 2 = moderate, 3 = severe */
	severity: number;
}

/**
 * Nudge messages that escalate in urgency as repetitions increase.
 * Thresholds: 5 repetitions = mild, 8 = moderate, 12 = severe.
 */
const ESCALATING_NUDGES = [
	{
