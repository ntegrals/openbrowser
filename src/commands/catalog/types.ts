import { z } from 'zod';
import type { CommandResult } from '../../types';

export interface CommandContext {
  page: import('playwright').Page;
  cdpSession?: import('playwright').CDPSession;
}

export type CommandExecutor = (args: unknown, context: CommandContext) => Promise<CommandResult>;
