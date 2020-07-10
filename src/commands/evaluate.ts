import { Page } from 'playwright';
import { CommandResult } from '../types';
import { CommandError } from '../errors';
import { createLogger } from '../logging';

const logger = createLogger('cmd:evaluate');

/**
 * Evaluate JavaScript expression in the page context.
 */
export async function evaluate(
  page: Page,
  expression: string,
): Promise<CommandResult> {
  const start = Date.now();
  logger.debug(`evaluate: ${expression.slice(0, 50)}`);

  try {
    const result = await page.evaluate(expression);
    return {
      success: true,
      message: 'Evaluation complete',
      data: result,
      duration: Date.now() - start,
    };
  } catch (err) {
    throw new CommandError(
      'evaluate',
      err instanceof Error ? err.message : String(err),
    );
  }
}
