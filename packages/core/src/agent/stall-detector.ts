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

	recordAction(actions: Command[]): void {
		const key = this.normalizeActionHash(actions);
		this.actionHistory.push(key);

		// Keep only the window
		if (this.actionHistory.length > this.options.windowSize * 2) {
			this.actionHistory = this.actionHistory.slice(-this.options.windowSize * 2);
		}
	}

	recordFingerprint(fingerprint: PageSignature): void {
		this.fingerprintHistory.push(fingerprint);
		const hash = this.hashFingerprint(fingerprint);
		this.fingerprintHashes.push(hash);

		if (this.fingerprintHistory.length > this.options.windowSize * 2) {
			this.fingerprintHistory = this.fingerprintHistory.slice(-this.options.windowSize * 2);
			this.fingerprintHashes = this.fingerprintHashes.slice(-this.options.windowSize * 2);
		}
	}

	isStuck(): StallCheckResult {
		// Check for repeated actions
		const actionRepetitions = this.countTrailingRepetitions(this.actionHistory);

		if (actionRepetitions >= this.options.maxRepeatedActions) {
			this.totalRepetitions += actionRepetitions;
			const severity = this.getSeverity(actionRepetitions);
			return {
				stuck: true,
				reason: `Same action repeated ${actionRepetitions} times`,
				severity,
			};
		}

		// Check for action cycle (A -> B -> A -> B)
		if (this.actionHistory.length >= 4) {
			const last4 = this.actionHistory.slice(-4);
			if (last4[0] === last4[2] && last4[1] === last4[3]) {
				this.totalRepetitions += 2;
				return {
					stuck: true,
					reason: 'Detected action cycle (alternating between two actions)',
					severity: this.getSeverity(this.totalRepetitions),
				};
			}
		}

		// Check for triple cycle (A -> B -> C -> A -> B -> C)
		if (this.actionHistory.length >= 6) {
			const last6 = this.actionHistory.slice(-6);
			if (
				last6[0] === last6[3] &&
				last6[1] === last6[4] &&
				last6[2] === last6[5]
			) {
				this.totalRepetitions += 3;
				return {
					stuck: true,
					reason: 'Detected 3-step action cycle',
					severity: this.getSeverity(this.totalRepetitions),
				};
			}
		}

		// Check for repeated fingerprints (same page state)
		const fpRepetitions = this.countTrailingRepetitions(this.fingerprintHashes);

		if (fpRepetitions >= this.options.maxRepeatedFingerprints) {
			this.totalRepetitions += fpRepetitions;
			return {
				stuck: true,
				reason: `Page state unchanged for ${fpRepetitions} steps`,
				severity: this.getSeverity(fpRepetitions),
			};
		}

		// Check for consecutive stagnant pages (URL + elementCount unchanged)
		const stagnantCount = this.countConsecutiveStagnantPages();
		if (stagnantCount >= this.options.maxStagnantPages) {
			this.totalRepetitions += stagnantCount;
			return {
				stuck: true,
				reason: `Page appears stagnant for ${stagnantCount} consecutive steps (same URL and element structure)`,
				severity: this.getSeverity(stagnantCount),
			};
		}

		return { stuck: false, severity: 0 };
	}

	getLoopNudgeMessage(): string {
		const result = this.isStuck();
		if (!result.stuck) {
			return '';
		}

		// Find the appropriate escalating nudge
		const nudge = this.getEscalatingNudge();
		return `Warning: ${result.reason ?? 'You appear to be stuck'}.\n${nudge}`;
	}

	/** Get total number of detected repetitions across the session */
	getTotalRepetitions(): number {
		return this.totalRepetitions;
	}

	reset(): void {
		this.actionHistory = [];
		this.fingerprintHistory = [];
		this.fingerprintHashes = [];
		this.totalRepetitions = 0;
	}

	// ── Private helpers ──

	/**
	 * Normalize action hash for better deduplication:
	 * - Sort search token strings for order-independent matching
