import { createLogger } from './logging.js';

const logger = createLogger('perf');

export interface TimingResult<T> {
	result: T;
	durationMs: number;
}

/**
 * Wraps an async function to measure and log its execution time.
 * Returns the result along with timing information.
 */
export async function timed<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<TimingResult<T>> {
	const start = performance.now();
	try {
		const result = await fn();
		const durationMs = performance.now() - start;
		logger.debug(`${label}: ${durationMs.toFixed(1)}ms`);
		return { result, durationMs };
	} catch (error) {
		const durationMs = performance.now() - start;
		logger.debug(`${label}: FAILED after ${durationMs.toFixed(1)}ms`);
		throw error;
	}
}

/**
 * Creates a decorator-style wrapper that times all calls to the provided function.
 */
export function withTiming<Args extends unknown[], R>(
	label: string,
	fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
	return async (...args: Args): Promise<R> => {
		const { result } = await timed(label, () => fn(...args));
		return result;
	};
}

/**
 * Simple stopwatch for manual timing control.
 */
export class Stopwatch {
	private startTime: number;
	private splits: Array<{ label: string; timeMs: number }> = [];

	constructor() {
		this.startTime = performance.now();
	}

	split(label: string): number {
		const elapsed = performance.now() - this.startTime;
		this.splits.push({ label, timeMs: elapsed });
		return elapsed;
	}

	elapsed(): number {
		return performance.now() - this.startTime;
	}

	reset(): void {
		this.startTime = performance.now();
		this.splits = [];
	}

	getSplits(): Array<{ label: string; timeMs: number }> {
		return [...this.splits];
	}

	summary(): string {
		const lines = this.splits.map(
			(s) => `  ${s.label}: ${s.timeMs.toFixed(1)}ms`,
		);
		lines.push(`  total: ${this.elapsed().toFixed(1)}ms`);
		return lines.join('\n');
	}
}
