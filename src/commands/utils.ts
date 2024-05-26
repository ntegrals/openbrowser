/**
 * Validate a CSS selector.
 */
export function isValidSelector(selector: string): boolean {
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a command result for display.
 */
export function formatCommandResult(name: string, args: unknown): string {
  const argsStr = typeof args === 'string' ? args : JSON.stringify(args);
  return `${name}(${argsStr.slice(0, 80)})`;
}
