import { z } from 'zod';
import { createLogger } from '../../logging';
import type { CommandResult } from '../../types';

const logger = createLogger('command-catalog');

export interface CatalogEntry {
  name: string;
  description: string;
  schema: z.ZodType<any>;
  execute: (args: any, context: any) => Promise<CommandResult>;
}

/**
 * Registry for all available commands.
 * Commands register themselves with a name, schema, and executor.
 */
export class CommandCatalog {
  private entries = new Map<string, CatalogEntry>();

  register(entry: CatalogEntry): void {
    if (this.entries.has(entry.name)) {
      logger.warn(`Overwriting command: ${entry.name}`);
    }
    this.entries.set(entry.name, entry);
  }

  get(name: string): CatalogEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): CatalogEntry[] {
    return Array.from(this.entries.values());
  }

  getSchemas(): Record<string, z.ZodType<any>> {
    const schemas: Record<string, z.ZodType<any>> = {};
    for (const [name, entry] of this.entries) {
      schemas[name] = entry.schema;
    }
    return schemas;
  }
}
