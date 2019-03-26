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
