import type {
	SandboxOptions,
	SandboxResult,
	SandboxError,
	SandboxMetrics,
	CapturedOutput,
	ResourceSnapshot,
	SandboxErrorCategory,
} from './types.js';
import { Viewport, Agent, type AgentOptions, type CommandResult } from 'open-browser';

// ── Defaults ──

const DEFAULT_OPTIONS: Required<SandboxOptions> = {
	timeout: 300_000,
	maxMemoryMB: 512,
	allowedDomains: [],
	blockedDomains: [],
	enableNetworking: true,
	enableFileAccess: false,
	workDir: process.cwd(),
	resourceCheckIntervalMs: 1_000,
	captureOutput: true,
	stepLimit: 100,
};

// ── Resource Monitor ──

/**
 * Monitors memory and CPU usage during sandbox execution.
 * Takes periodic snapshots and detects OOM conditions.
 */
class ResourceMonitor {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private snapshots: ResourceSnapshot[] = [];
	private peakMemoryMB = 0;
	private startCpuUsage: NodeJS.CpuUsage | null = null;
	private readonly limitMB: number;
	private onOOM: (() => void) | null = null;

	constructor(limitMB: number) {
		this.limitMB = limitMB;
	}

	start(intervalMs: number, onOOM: () => void): void {
		this.startCpuUsage = process.cpuUsage();
		this.onOOM = onOOM;
		this.takeSnapshot();

		this.intervalId = setInterval(() => {
			this.takeSnapshot();
		}, intervalMs);
	}

	stop(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		// Final snapshot
		this.takeSnapshot();
	}

	private takeSnapshot(): void {
		const mem = process.memoryUsage();
		const cpu = this.startCpuUsage
			? process.cpuUsage(this.startCpuUsage)
			: process.cpuUsage();

		const rssMB = mem.rss / (1024 * 1024);
		const heapUsedMB = mem.heapUsed / (1024 * 1024);
		const heapTotalMB = mem.heapTotal / (1024 * 1024);
		const externalMB = mem.external / (1024 * 1024);

		const snapshot: ResourceSnapshot = {
			timestampMs: Date.now(),
			heapUsedMB,
			heapTotalMB,
			rssMB,
			externalMB,
			cpuUserMs: cpu.user / 1000,
			cpuSystemMs: cpu.system / 1000,
		};

		this.snapshots.push(snapshot);

		if (rssMB > this.peakMemoryMB) {
			this.peakMemoryMB = rssMB;
		}

		// Check OOM condition against RSS (total process memory)
		if (rssMB > this.limitMB && this.onOOM) {
			this.onOOM();
		}
	}

	getPeakMemoryMB(): number {
		return Math.round(this.peakMemoryMB * 100) / 100;
	}

	getCpuTimeMs(): number {
		if (!this.startCpuUsage) return 0;
		const usage = process.cpuUsage(this.startCpuUsage);
		return Math.round((usage.user + usage.system) / 1000);
	}

	getSnapshots(): ResourceSnapshot[] {
		return [...this.snapshots];
	}

	getCurrentMemoryMB(): number {
		const mem = process.memoryUsage();
		return Math.round((mem.rss / (1024 * 1024)) * 100) / 100;
	}
}

// ── Output Capture ──

/**
 * Captures stdout and stderr output during execution.
 * Intercepts process.stdout.write and process.stderr.write.
 */
class OutputCapture {
	private stdoutChunks: string[] = [];
	private stderrChunks: string[] = [];
	private originalStdoutWrite: typeof process.stdout.write | null = null;
	private originalStderrWrite: typeof process.stderr.write | null = null;
	private active = false;

	start(): void {
		if (this.active) return;
		this.active = true;
		this.stdoutChunks = [];
		this.stderrChunks = [];

		this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
		this.originalStderrWrite = process.stderr.write.bind(process.stderr);

		process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
			const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			this.stdoutChunks.push(text);
			// Still write to original stdout for real-time visibility
			return this.originalStdoutWrite!(chunk as string, ...args as []);
		}) as typeof process.stdout.write;

		process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
			const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			this.stderrChunks.push(text);
			return this.originalStderrWrite!(chunk as string, ...args as []);
		}) as typeof process.stderr.write;
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;

		if (this.originalStdoutWrite) {
			process.stdout.write = this.originalStdoutWrite as typeof process.stdout.write;
			this.originalStdoutWrite = null;
		}
		if (this.originalStderrWrite) {
			process.stderr.write = this.originalStderrWrite as typeof process.stderr.write;
			this.originalStderrWrite = null;
		}
	}

	getOutput(): CapturedOutput {
		return {
			stdout: this.stdoutChunks.join(''),
			stderr: this.stderrChunks.join(''),
		};
	}
}

// ── Sandbox ──

/**
 * Sandboxed execution environment for browser automation.
 * Runs agent tasks in an isolated context with resource limits,
 * output capture, and comprehensive metrics.
 */
export class Sandbox {
	private options: Required<SandboxOptions>;

	constructor(options?: SandboxOptions) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Run an agent task inside the sandbox with resource monitoring,
	 * output capture, and timeout enforcement.
	 */
	async run(agentOptions: Omit<AgentOptions, 'browser'>): Promise<SandboxResult> {
		const startTime = Date.now();
		const resourceMonitor = new ResourceMonitor(this.options.maxMemoryMB);
		const outputCapture = new OutputCapture();

		// Track visited URLs and step/action counts
		const visitedUrls = new Set<string>();
		let stepsExecuted = 0;
		let totalActions = 0;

		// OOM abort controller
		let oomTriggered = false;
		const abortController = new AbortController();

		const browser = new Viewport({
			headless: true,
			allowedUrls: this.options.allowedDomains.length > 0
				? this.options.allowedDomains
				: undefined,
			blockedUrls: this.options.blockedDomains.length > 0
				? this.options.blockedDomains
				: undefined,
		});

		// Start resource monitoring with OOM callback
		resourceMonitor.start(this.options.resourceCheckIntervalMs, () => {
			if (!oomTriggered) {
				oomTriggered = true;
				abortController.abort();
			}
		});

		// Start output capture
		if (this.options.captureOutput) {
			outputCapture.start();
		}

		try {
			await browser.start();

			const agent = new Agent({
				...agentOptions,
				browser,
				settings: {
					...agentOptions.settings,
					allowedUrls: this.options.allowedDomains,
					blockedUrls: this.options.blockedDomains,
					stepLimit: this.options.stepLimit,
				},
				onStepStart: (step) => {
					stepsExecuted = step;
					// Track URL at step start
					try {
						const url = browser.currentPage?.url();
						if (url && url !== 'about:blank') {
							visitedUrls.add(url);
						}
					} catch {
						// Page may not be ready
					}
					// Delegate to caller's onStepStart if provided
					agentOptions.onStepStart?.(step);
				},
				onStepEnd: (step, results) => {
					totalActions += results.length;
					// Track URL at step end (may have changed)
					try {
						const url = browser.currentPage?.url();
						if (url && url !== 'about:blank') {
							visitedUrls.add(url);
						}
					} catch {
						// Page may not be ready
					}
					agentOptions.onStepEnd?.(step, results);
				},
			});

			// Race the agent execution against timeout and OOM
			const result = await Promise.race([
				this.executeAgent(agent, startTime),
				this.createTimeoutPromise(startTime),
				this.createOOMPromise(abortController.signal, startTime, resourceMonitor),
			]);

			// Build metrics
			const metrics = this.buildMetrics(
				startTime,
				resourceMonitor,
				stepsExecuted,
				visitedUrls,
				totalActions,
			);

			return {
				...result,
				memoryUsageMB: resourceMonitor.getCurrentMemoryMB(),
				capturedOutput: this.options.captureOutput ? outputCapture.getOutput() : undefined,
				metrics,
			};
		} catch (error) {
			const sandboxError = this.classifyError(error, oomTriggered);
			const metrics = this.buildMetrics(
				startTime,
				resourceMonitor,
				stepsExecuted,
				visitedUrls,
				totalActions,
			);

			return {
				success: false,
				error: sandboxError,
				errorMessage: sandboxError.message,
				duration: Date.now() - startTime,
				memoryUsageMB: resourceMonitor.getCurrentMemoryMB(),
				capturedOutput: this.options.captureOutput ? outputCapture.getOutput() : undefined,
				metrics,
			};
		} finally {
			// Always clean up in reverse order
			resourceMonitor.stop();
			if (this.options.captureOutput) {
				outputCapture.stop();
			}
			await this.forceCleanup(browser);
		}
	}

	/**
	 * Execute the agent and wrap the result.
	 */
	private async executeAgent(
		agent: Agent,
		startTime: number,
	): Promise<SandboxResult> {
		const result = await agent.run();
		return {
			success: result.success,
			output: result.finalResult,
			duration: Date.now() - startTime,
		};
	}

	/**
	 * Create a timeout promise that resolves with a timeout error.
	 */
	private createTimeoutPromise(startTime: number): Promise<SandboxResult> {
		return new Promise<SandboxResult>((resolve) => {
			setTimeout(() => {
				resolve({
					success: false,
					error: {
						category: 'timeout',
						message: `Sandbox timeout after ${this.options.timeout}ms`,
					},
					errorMessage: `Sandbox timeout after ${this.options.timeout}ms`,
					duration: Date.now() - startTime,
				});
			}, this.options.timeout);
		});
	}

	/**
	 * Create a promise that rejects when OOM is detected via the AbortSignal.
	 */
	private createOOMPromise(
		signal: AbortSignal,
		startTime: number,
		monitor: ResourceMonitor,
	): Promise<SandboxResult> {
		return new Promise<SandboxResult>((resolve) => {
			const onAbort = () => {
				resolve({
					success: false,
					error: {
						category: 'oom',
						message: `Memory limit exceeded: ${monitor.getPeakMemoryMB()}MB > ${this.options.maxMemoryMB}MB`,
					},
					errorMessage: `Memory limit exceeded: ${monitor.getPeakMemoryMB()}MB > ${this.options.maxMemoryMB}MB`,
					duration: Date.now() - startTime,
					memoryUsageMB: monitor.getPeakMemoryMB(),
				});
			};

			if (signal.aborted) {
				onAbort();
			} else {
				signal.addEventListener('abort', onAbort, { once: true });
			}
		});
	}

	/**
	 * Classify an error into a SandboxError with the appropriate category.
	 */
	private classifyError(error: unknown, oomTriggered: boolean): SandboxError {
		if (oomTriggered) {
			return {
				category: 'oom',
				message: 'Execution terminated due to memory limit exceeded',
				stack: error instanceof Error ? error.stack : undefined,
			};
		}

		const message = error instanceof Error ? error.message : String(error);
		const stack = error instanceof Error ? error.stack : undefined;

		// Detect browser crashes
		if (
			message.includes('browser has been closed') ||
			message.includes('Target page') ||
			message.includes('Target closed') ||
			message.includes('Protocol error')
		) {
			return { category: 'crash', message, stack };
		}

		// Detect timeout patterns
		if (
			message.includes('timeout') ||
			message.includes('Timeout') ||
			message.includes('ETIMEDOUT')
		) {
			return { category: 'timeout', message, stack };
		}

		// Detect agent-specific errors
		if (
			message.includes('Agent') ||
			message.includes('maximum steps') ||
			message.includes('stuck in a loop')
		) {
			return { category: 'agent_error', message, stack };
		}

		// Detect browser/navigation errors
		if (
			message.includes('net::ERR_') ||
			message.includes('Navigation') ||
			message.includes('navigation')
		) {
			return { category: 'browser_error', message, stack };
		}

		return { category: 'unknown', message, stack };
	}

	/**
	 * Build metrics from the execution data.
	 */
	private buildMetrics(
		startTime: number,
		monitor: ResourceMonitor,
		stepsExecuted: number,
		visitedUrls: Set<string>,
		totalActions: number,
	): SandboxMetrics {
		return {
			durationMs: Date.now() - startTime,
			peakMemoryMB: monitor.getPeakMemoryMB(),
			stepsExecuted,
			pagesVisited: visitedUrls.size,
			visitedUrls: [...visitedUrls],
			totalActions,
			cpuTimeMs: monitor.getCpuTimeMs(),
		};
	}

	/**
	 * Force cleanup of browser resources. Catches and ignores errors
	 * since the browser may already be crashed or closed.
	 */
	private async forceCleanup(browser: Viewport): Promise<void> {
		try {
			await Promise.race([
				browser.close(),
				// Give cleanup 5 seconds max, then move on
				new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
			]);
		} catch {
			// Browser may already be closed or crashed - ignore
		}
	}

	/**
	 * Get the current sandbox configuration.
	 */
	getOptions(): Readonly<Required<SandboxOptions>> {
		return { ...this.options };
	}
}
