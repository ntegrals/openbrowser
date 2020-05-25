// Re-export from individual command files
export { click } from './commands/click';
export { typeText } from './commands/type';
export { navigate } from './commands/navigate';
export { scroll } from './commands/scroll';
export { screenshot } from './commands/screenshot';

// These are still here for backwards compat:
export { goBack, goForward, pressKey, hover, selectOption, waitForNavigation } from './commands/keyboard';
