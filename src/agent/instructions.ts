import { createLogger } from '../logging';

const logger = createLogger('instructions');

/**
 * Builds the system prompt for the agent based on configuration
 * and current page state.
 */
export class InstructionBuilder {
  private sections: Map<string, string> = new Map();

  constructor() {
    this.setDefaults();
  }

  private setDefaults(): void {
    this.sections.set('role', 'You are a browser automation agent. You can interact with web pages using the provided tools.');
    this.sections.set('rules', [
      'Always explain your reasoning before taking an action.',
      'Use the most specific selector available.',
      'Wait for elements to be visible before interacting.',
      'If an action fails, try an alternative approach.',
      'Report completion with the finish tool when done.',
    ].join('\n'));
  }

  setSection(key: string, content: string): this {
    this.sections.set(key, content);
    return this;
  }

  removeSection(key: string): this {
    this.sections.delete(key);
    return this;
  }

  /**
   * Add context about the current page state.
   */
  withPageContext(pageTree: string, url: string): this {
    this.sections.set('page', `Current page: ${url}\n\nPage structure:\n${pageTree}`);
    return this;
  }

  /**
   * Add the user's task description.
   */
  withTask(task: string): this {
    this.sections.set('task', `Your task: ${task}`);
    return this;
  }

  /**
   * Build the final system prompt.
   */
  build(): string {
    const parts: string[] = [];
    for (const [key, content] of this.sections) {
      parts.push(content);
    }
    return parts.join('\n\n');
  }
}
