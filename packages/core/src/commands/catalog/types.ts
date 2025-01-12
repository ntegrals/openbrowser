import type { z } from 'zod';
import type { CommandResult, ExecutionContext } from '../types.js';

export interface CatalogEntry {
	name: string;
	description: string;
	schema: z.ZodTypeAny;
	handler: (params: Record<string, unknown>, context: ExecutionContext) => Promise<CommandResult>;
	terminatesSequence?: boolean;
	domainFilter?: string[];
}

export interface CatalogOptions {
	excludeActions?: string[];
	includeActions?: string[];
}
