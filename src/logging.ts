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
    this.log(LogLevel.INFO, msg, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, msg, ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, msg, ...args);
  }

  private log(level: LogLevel, msg: string, ...args: unknown[]): void {
    if (level < globalLevel) return;

    const label = LEVEL_LABELS[level];
    const prefix = `${timestamp()} ${label} [${this.name}]`;

    if (level >= LogLevel.ERROR) {
      console.error(prefix, msg, ...args);
    } else if (level >= LogLevel.WARN) {
      console.warn(prefix, msg, ...args);
    } else {
      console.log(prefix, msg, ...args);
    }
  }
}

const loggers = new Map<string, Logger>();

export function createLogger(name: string): Logger {
  let logger = loggers.get(name);
  if (!logger) {
    logger = new Logger(name);
    loggers.set(name, logger);
  }
  return logger;
}
