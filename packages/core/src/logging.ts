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
