import { CommandCatalog } from './catalog/catalog';
import type { CommandResult } from '../types';
import { CommandError } from '../errors';
import { createLogger } from '../logging';

const logger = createLogger('command-executor');

/**
 * Executes commands by looking them up in the catalog and running them.
 */
export class CommandExecutor {
  constructor(private readonly catalog: CommandCatalog) {}

  async execute(
    commandName: string,
    args: unknown,
    context: any,
  ): Promise<CommandResult> {
    const entry = this.catalog.get(commandName);
    if (!entry) {
      throw new CommandError(commandName, `Unknown command: ${commandName}`);
    }

    logger.debug(`Executing: ${commandName}`);

    // Validate args against schema
    const parsed = entry.schema.safeParse(args);
    if (!parsed.success) {
      throw new CommandError(
        commandName,
        `Invalid arguments: ${parsed.error.message}`,
      );
    }

    const start = Date.now();
    try {
      const result = await entry.execute(parsed.data, context);
      logger.debug(`${commandName} completed in ${Date.now() - start}ms`);
      return result;
    } catch (err) {
      if (err instanceof CommandError) throw err;
      throw new CommandError(
        commandName,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
