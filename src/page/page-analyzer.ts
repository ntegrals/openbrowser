import { Page, CDPSession } from 'playwright';
import { createLogger } from '../logging';
import { buildSnapshot } from './snapshot-builder';
import type { PageSnapshot } from './types';

const logger = createLogger('page-analyzer');

/**
 * High-level page analysis combining DOM snapshot,
 * scroll position, and accessibility info.
 */
export class PageAnalyzer {
  constructor(
    private readonly page: Page,
    private readonly cdp?: CDPSession,
  ) {}

  async analyze(): Promise<PageSnapshot> {
    logger.debug('Analyzing page');
    return buildSnapshot(this.page);
  }
}
