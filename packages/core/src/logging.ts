import { LogLevel } from './types.js';

const LEVEL_NAMES: Record<number, string> = {
	[LogLevel.DEBUG]: 'DEBUG',
	[LogLevel.INFO]: 'INFO',
	[LogLevel.WARN]: 'WARN',
	[LogLevel.ERROR]: 'ERROR',
};

const LEVEL_COLORS: Record<number, string> = {
	[LogLevel.DEBUG]: '\x1b[36m', // cyan
	[LogLevel.INFO]: '\x1b[32m',  // green
	[LogLevel.WARN]: '\x1b[33m',  // yellow
	[LogLevel.ERROR]: '\x1b[31m', // red
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

let globalLevel: LogLevel = LogLevel.INFO;
let useColors = true;
let logTimestamps = true;

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

export class Logger {
	readonly name: string;
	private level: LogLevel | null = null;

	constructor(name: string) {
		this.name = name;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	getEffectiveLevel(): LogLevel {
		return this.level ?? globalLevel;
	}

	isEnabled(level: LogLevel): boolean {
		return level >= this.getEffectiveLevel();
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

	private log(level: LogLevel, message: string, ...args: unknown[]): void {
		if (!this.isEnabled(level)) return;

		const formatted = formatMessage(level, this.name, message);

		switch (level) {
			case LogLevel.ERROR:
				console.error(formatted, ...args);
				break;
			case LogLevel.WARN:
				console.warn(formatted, ...args);
				break;
			default:
				console.log(formatted, ...args);
		}
	}
}

const loggerCache = new Map<string, Logger>();

export function createLogger(name: string): Logger {
	let logger = loggerCache.get(name);
	if (!logger) {
		logger = new Logger(name);
		loggerCache.set(name, logger);
	}
	return logger;
}
