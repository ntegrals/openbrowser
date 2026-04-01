import { LogLevel } from './types.js';

// ── Types ──

export interface LogSink {
	write(entry: LogEntry): void;
}

export interface LogEntry {
	level: LogLevel;
	name: string;
	message: string;
	args: unknown[];
	timestamp: Date;
}

// ── Constants ──

const LEVEL_NAMES: Record<number, string> = {
	[LogLevel.TRACE]: 'TRACE',
	[LogLevel.DEBUG]: 'DEBUG',
	[LogLevel.INFO]: 'INFO',
	[LogLevel.WARN]: 'WARN',
	[LogLevel.ERROR]: 'ERROR',
};

const LEVEL_COLORS: Record<number, string> = {
	[LogLevel.TRACE]: '\x1b[90m', // gray
	[LogLevel.DEBUG]: '\x1b[36m', // cyan
	[LogLevel.INFO]: '\x1b[32m',  // green
	[LogLevel.WARN]: '\x1b[33m',  // yellow
	[LogLevel.ERROR]: '\x1b[31m', // red
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const LEVEL_PARSE_MAP: Record<string, LogLevel> = {
	trace: LogLevel.TRACE,
	debug: LogLevel.DEBUG,
	info: LogLevel.INFO,
	warn: LogLevel.WARN,
	error: LogLevel.ERROR,
	silent: LogLevel.SILENT,
};

// ── Global state ──

let globalLevel: LogLevel = resolveInitialLogLevel();
let useColors = true;
let logTimestamps = true;
let globalSink: LogSink | null = null;

function resolveInitialLogLevel(): LogLevel {
	const env =
		(typeof process !== 'undefined' && process.env?.OPEN_BROWSER_LOG_LEVEL) ||
		(typeof process !== 'undefined' && process.env?.LOG_LEVEL);
	if (env) {
		const parsed = LEVEL_PARSE_MAP[env.toLowerCase()];
		if (parsed !== undefined) return parsed;
	}
	return LogLevel.INFO;
}

// ── Global configuration ──

export function setGlobalLogLevel(level: LogLevel): void {
	globalLevel = level;
}

export function getGlobalLogLevel(): LogLevel {
	return globalLevel;
}

export function setLogColors(enabled: boolean): void {
	useColors = enabled;
}

export function setLogTimestamps(enabled: boolean): void {
	logTimestamps = enabled;
}

export function setGlobalLogSink(sink: LogSink | null): void {
	globalSink = sink;
}

export function getGlobalLogSink(): LogSink | null {
	return globalSink;
}

export function parseLogLevel(value: string): LogLevel | undefined {
	return LEVEL_PARSE_MAP[value.toLowerCase()];
}

// ── Formatting ──

function formatTimestamp(): string {
	const now = new Date();
	const h = now.getHours().toString().padStart(2, '0');
	const m = now.getMinutes().toString().padStart(2, '0');
	const s = now.getSeconds().toString().padStart(2, '0');
	const ms = now.getMilliseconds().toString().padStart(3, '0');
	return `${h}:${m}:${s}.${ms}`;
}

function formatMessage(
	level: LogLevel,
	name: string,
	message: string,
): string {
	const parts: string[] = [];

	if (logTimestamps) {
		const ts = formatTimestamp();
		parts.push(useColors ? `${DIM}${ts}${RESET}` : ts);
	}

	const levelName = LEVEL_NAMES[level] ?? 'UNKNOWN';
	const color = LEVEL_COLORS[level] ?? '';

	if (useColors) {
		parts.push(`${color}${levelName.padEnd(5)}${RESET}`);
		parts.push(`${BOLD}[${name}]${RESET}`);
	} else {
		parts.push(levelName.padEnd(5));
		parts.push(`[${name}]`);
	}

	parts.push(message);
	return parts.join(' ');
}

// ── Default console sink ──

const consoleSink: LogSink = {
	write(entry: LogEntry): void {
		const formatted = formatMessage(entry.level, entry.name, entry.message);
		switch (entry.level) {
			case LogLevel.ERROR:
				console.error(formatted, ...entry.args);
				break;
			case LogLevel.WARN:
				console.warn(formatted, ...entry.args);
				break;
			default:
				console.log(formatted, ...entry.args);
		}
	},
};

// ── Logger ──

export class Logger {
	readonly name: string;
	private level: LogLevel | null = null;
	private sink: LogSink | null = null;

	constructor(name: string) {
		this.name = name;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	setSink(sink: LogSink | null): void {
		this.sink = sink;
	}

	getEffectiveLevel(): LogLevel {
		return this.level ?? globalLevel;
	}

	isEnabled(level: LogLevel): boolean {
		return level >= this.getEffectiveLevel();
	}

	trace(message: string, ...args: unknown[]): void {
		this.log(LogLevel.TRACE, message, ...args);
	}

	debug(message: string, ...args: unknown[]): void {
		this.log(LogLevel.DEBUG, message, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		this.log(LogLevel.INFO, message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.log(LogLevel.WARN, message, ...args);
	}

	error(message: string, ...args: unknown[]): void {
		this.log(LogLevel.ERROR, message, ...args);
	}

	child(childName: string): Logger {
		const child = createLogger(`${this.name}:${childName}`);
		if (this.level !== null) child.setLevel(this.level);
		if (this.sink !== null) child.setSink(this.sink);
		return child;
	}

	private log(level: LogLevel, message: string, ...args: unknown[]): void {
		if (!this.isEnabled(level)) return;

		const entry: LogEntry = {
			level,
			name: this.name,
			message,
			args,
			timestamp: new Date(),
		};

		const sink = this.sink ?? globalSink ?? consoleSink;
		sink.write(entry);
	}
}

// ── Factory ──

const loggerCache = new Map<string, Logger>();

export function createLogger(name: string): Logger {
	let logger = loggerCache.get(name);
	if (!logger) {
		logger = new Logger(name);
		loggerCache.set(name, logger);
	}
	return logger;
}
