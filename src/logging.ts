/**
 * Simple logging utility.
 * Levels: debug < info < warn < error
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

let globalLevel: LogLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: ' INFO',
  [LogLevel.WARN]: ' WARN',
  [LogLevel.ERROR]: 'ERROR',
};

function timestamp(): string {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export class Logger {
  constructor(private readonly name: string) {}

  debug(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, msg, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
