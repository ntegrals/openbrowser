/**
 * Base error class for open-browser.
 */
export class OpenBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenBrowserError';
    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the browser viewport encounters an error.
 */
export class ViewportError extends OpenBrowserError {
  constructor(message: string) {
    super(message);
    this.name = 'ViewportError';
  }
}

/**
 * Thrown when the browser fails to launch.
 */
export class LaunchFailedError extends ViewportError {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchFailedError';
  }
}

/**
 * Thrown when navigation fails.
 */
export class NavigationFailedError extends ViewportError {
  public readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = 'NavigationFailedError';
    this.url = url;
  }
}

/**
 * Thrown when a command fails to execute.
 */
export class CommandError extends OpenBrowserError {
  public readonly command: string;

  constructor(command: string, message: string) {
    super(`Command "${command}" failed: ${message}`);
    this.name = 'CommandError';
    this.command = command;
  }
}

/**
 * Thrown when an element cannot be found on the page.
 */
export class ElementNotFoundError extends OpenBrowserError {
  public readonly selector: string;

  constructor(selector: string) {
    super(`Element not found: ${selector}`);
    this.name = 'ElementNotFoundError';
    this.selector = selector;
  }
}

/**
 * Thrown when an operation times out.
 */
export class AgentError extends OpenBrowserError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

export class AgentStalledError extends AgentError {
  constructor(message = 'Agent is stuck in a loop') {
    super(message);
    this.name = 'AgentStalledError';
  }
}

export class ModelError extends OpenBrowserError {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

export class ModelThrottledError extends ModelError {
  public readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ModelThrottledError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class TimeoutError extends OpenBrowserError {
  public readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
