// ── Sandbox configuration ──

export interface SandboxOptions {
	/** Maximum execution time in milliseconds (default: 300000 = 5 minutes) */
	timeout?: number;
	/** Maximum memory usage in MB (default: 512) */
	maxMemoryMB?: number;
	/** Domains the agent is allowed to visit */
	allowedDomains?: string[];
	/** Domains the agent is blocked from visiting */
	blockedDomains?: string[];
	/** Whether network access is allowed (default: true) */
	enableNetworking?: boolean;
	/** Whether file system access is allowed (default: false) */
	enableFileAccess?: boolean;
	/** Working directory for the sandbox */
	workDir?: string;
	/** Interval in ms to check resource usage (default: 1000) */
	resourceCheckIntervalMs?: number;
	/** Whether to capture stdout/stderr from the agent execution (default: true) */
	captureOutput?: boolean;
	/** Maximum number of agent steps (default: 100) */
	stepLimit?: number;
}

// ── Sandbox error categories ──

export type SandboxErrorCategory =
	| 'timeout'
	| 'oom'
	| 'crash'
	| 'agent_error'
	| 'browser_error'
	| 'unknown';

export interface SandboxError {
	category: SandboxErrorCategory;
	message: string;
	/** Original stack trace if available */
	stack?: string;
}

// ── Output capture ──

export interface CapturedOutput {
	stdout: string;
	stderr: string;
}

// ── Metrics ──

export interface SandboxMetrics {
	/** Total execution time in milliseconds */
	durationMs: number;
	/** Peak memory usage in MB */
	peakMemoryMB: number;
	/** Number of agent steps executed */
	stepsExecuted: number;
	/** Number of unique pages visited */
	pagesVisited: number;
	/** URLs of pages visited */
	visitedUrls: string[];
	/** Number of actions taken across all steps */
	totalActions: number;
	/** CPU time used (user + system) in milliseconds */
	cpuTimeMs: number;
}

// ── Sandbox result ──

export interface SandboxResult {
	success: boolean;
	output?: string;
	error?: SandboxError;
	/** Legacy string error for backwards compatibility */
	errorMessage?: string;
	duration: number;
	memoryUsageMB?: number;
	/** Captured stdout/stderr from the execution */
	capturedOutput?: CapturedOutput;
	/** Detailed execution metrics */
	metrics?: SandboxMetrics;
}

// ── Resource monitor state ──

export interface ResourceSnapshot {
	timestampMs: number;
	heapUsedMB: number;
	heapTotalMB: number;
	rssMB: number;
	externalMB: number;
	cpuUserMs: number;
	cpuSystemMs: number;
}
