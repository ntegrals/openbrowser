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
	 * - Use element index (not full params) for click actions
	 * - Use URL (not full params) for navigate actions
	 */
	private normalizeActionHash(actions: Command[]): string {
		const normalized = actions.map((action) => {
			switch (action.action) {
				case 'tap':
					// Normalize click: use index as the primary key, ignore transient params
					return `click:${action.index}`;

				case 'type_text':
					return `input_text:${action.index}:${action.text}`;

				case 'navigate':
					// Normalize: just the URL
					return `go_to_url:${action.url}`;

				case 'web_search':
					// Sort search terms for order-independent matching
					return `search_google:${this.normalizeSearchQuery(action.query)}`;

				case 'search': {
					const q = 'query' in action ? String((action as Record<string, unknown>).query) : '';
					return `search_page:${this.normalizeSearchQuery(q)}`;
				}

				case 'scroll':
					return `scroll:${action.direction}:${action.index ?? 'page'}`;

				case 'finish':
					return `done:${action.text.slice(0, 50)}`;

				default:
					// Generic fallback: action name + stringified params
					return JSON.stringify(action);
			}
		});

		return normalized.join('|');
	}

	/**
	 * Normalize a search query by lowercasing and sorting tokens.
	 * "best pizza NYC" and "NYC best pizza" produce the same hash.
	 */
	private normalizeSearchQuery(query: string): string {
		return query
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean)
			.sort()
			.join(' ');
	}

	/**
	 * Hash a page fingerprint for quick equality checks.
	 * Includes URL, element count, text hash, and scroll position bucket.
	 */
	private hashFingerprint(fp: PageSignature): string {
		const scrollBucket = Math.floor(fp.scrollY / 200);
		const parts = [
			fp.url,
			fp.domHash,
			scrollBucket.toString(),
		];
		if (fp.elementCount !== undefined) {
			parts.push(`e:${fp.elementCount}`);
		}
		if (fp.textHash) {
			parts.push(`t:${fp.textHash}`);
		}
		return parts.join('|');
	}

	/**
	 * Count how many trailing entries in a history array are identical.
	 */
	private countTrailingRepetitions(history: string[]): number {
		if (history.length === 0) return 0;
		const last = history[history.length - 1];
		let count = 0;
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i] === last) {
				count++;
			} else {
				break;
			}
		}
		return count;
	}

	/**
	 * Count consecutive stagnant pages: same URL and similar element count.
	 * "Similar" means within 5% or 10 elements of each other.
	 */
	private countConsecutiveStagnantPages(): number {
		if (this.fingerprintHistory.length < 2) return 0;

		const latest = this.fingerprintHistory[this.fingerprintHistory.length - 1];
		let count = 1;

		for (let i = this.fingerprintHistory.length - 2; i >= 0; i--) {
			const fp = this.fingerprintHistory[i];
			if (fp.url !== latest.url) break;

			if (latest.elementCount !== undefined && fp.elementCount !== undefined) {
				const diff = Math.abs(latest.elementCount - fp.elementCount);
				const threshold = Math.max(10, Math.floor(latest.elementCount * 0.05));
				if (diff > threshold) break;
			}

			count++;
		}

		return count;
	}

	/**
	 * Map repetition count to severity level (0-3).
	 */
	private getSeverity(repetitions: number): number {
		if (repetitions >= 12) return 3;
		if (repetitions >= 8) return 2;
		if (repetitions >= 5) return 1;
		return 0;
	}

	/**
	 * Get the appropriate escalating nudge message based on total repetitions.
	 */
	private getEscalatingNudge(): string {
		// Pick the highest-threshold nudge that applies
		let bestNudge = ESCALATING_NUDGES[0];
		for (const nudge of ESCALATING_NUDGES) {
			if (this.totalRepetitions >= nudge.threshold) {
				bestNudge = nudge;
			}
		}
		return bestNudge.message;
	}
}

/**
 * Compute a fast 32-bit hash of a DOM tree string.
 * Used for quick fingerprint comparison.
 */
export function hashPageTree(domTree: string): string {
	let hash = 0;
	for (let i = 0; i < domTree.length; i++) {
		const char = domTree.charCodeAt(i);
		hash = ((hash << 5) - hash + char) | 0;
	}
	return hash.toString(36);
}

/**
 * Compute a content-based text hash from visible page text.
 * More robust than DOM hash for detecting actual content changes.
 */
export function hashTextContent(text: string): string {
