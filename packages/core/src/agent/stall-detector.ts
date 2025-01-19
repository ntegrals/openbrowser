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
		threshold: 5,
		severity: 1,
		message:
			'You seem to be repeating similar actions. Consider trying a different approach:\n' +
			'- Click a different element\n' +
			'- Try an alternative navigation path\n' +
			'- Use search to find what you need',
	},
	{
		threshold: 8,
		severity: 2,
		message:
			'WARNING: You are stuck in a loop and have been repeating actions. You MUST change your approach:\n' +
			'- Navigate to a completely different page\n' +
			'- Try a fundamentally different strategy\n' +
			'- If the current approach is not working, consider using the done action to report the issue',
	},
	{
		threshold: 12,
		severity: 3,
		message:
			'CRITICAL: You have been stuck for many steps. This approach is NOT working.\n' +
			'You MUST either:\n' +
			'1. Use the done action to report that the task cannot be completed with your current approach\n' +
			'2. Navigate to a completely different website or page\n' +
			'3. Try a radically different interaction method\n' +
			'Do NOT repeat the same actions again.',
	},
];

export class StallDetector {
	private actionHistory: string[] = [];
	private fingerprintHistory: PageSignature[] = [];
	private fingerprintHashes: string[] = [];
	private options: StallDetectorConfig;
	private totalRepetitions = 0;

	constructor(options?: Partial<StallDetectorConfig>) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}
