import { ViewportSize } from './types';

/**
 * Configuration options for the browser viewport.
 */
export interface ViewportConfig {
  /** Run in headless mode (default: true) */
  headless: boolean;
  /** Default viewport size */
  viewport: ViewportSize;
  /** Navigation timeout in ms (default: 30000) */
  navigationTimeout: number;
  /** Command execution timeout in ms (default: 10000) */
  commandTimeout: number;
  /** Extra arguments to pass to Chromium */
  extraArgs: string[];
  /** User data directory for persistent sessions */
  userDataDir?: string;
  /** Custom executable path for Chrome/Chromium */
  executablePath?: string;
  /** Whether to disable security features (default: false) */
  disableSecurity: boolean;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: ViewportConfig = {
  headless: true,
  viewport: { width: 1280, height: 800 },
  navigationTimeout: 30000,
  commandTimeout: 10000,
  extraArgs: [],
  disableSecurity: false,
};

/**
 * Create a config by merging partial options with defaults.
 */
export function createConfig(
  options: Partial<ViewportConfig> = {},
): ViewportConfig {
  return {
    ...DEFAULT_CONFIG,
    ...options,
