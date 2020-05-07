// open-browser - Programmable browser automation toolkit

export { Viewport } from './viewport';
export type { ViewportEvents } from './viewport';

export { DomInspector } from './dom-inspector';

export {
  click,
  typeText,
  navigate,
  scroll,
  screenshot,
  goBack,
  goForward,
  pressKey,
  hover,
  selectOption,
  waitForNavigation,
} from './commands';

export { EventHub } from './event-hub';

export {
  OpenBrowserError,
  ViewportError,
  LaunchFailedError,
  NavigationFailedError,
  CommandError,
  ElementNotFoundError,
  TimeoutError,
} from './errors';

export {
  createConfig,
  validateConfig,
  DEFAULT_CONFIG,
} from './config';
export type { ViewportConfig } from './config';

export { extractPageContent, extractTitle, extractMetaDescription } from './content-extractor';

export { BaseGuard, BlankPageGuard, CrashGuard, PopupGuard, UrlPolicyGuard } from './guards';
export type { GuardContext } from './guards';

export { createLogger, setLogLevel, LogLevel } from './logging';

export {
  generateId,
  sleep,
  sanitizeText,
  truncateText,
  stripTags,
  withTimeout,
  isValidUrl,
  normalizeUrl,
} from './utils';

export type {
  ElementRef,
  Position,
  Rect,
  Result,
  ViewportSize,
  ElementInfo,
  CommandResult,
  ScreenshotData,
  PageInfo,
} from './types';
