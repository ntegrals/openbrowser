import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logging';
import type { AgentStep } from './types';

const logger = createLogger('replay-recorder');

interface ReplayEntry {
  timestamp: number;
  type: 'step' | 'screenshot' | 'page-update' | 'error';
  data: unknown;
}

/**
 * Records agent sessions for later replay and analysis.
 */
export class ReplayRecorder {
  private entries: ReplayEntry[] = [];
  private startTime: number;
  private outputPath: string | null = null;

  constructor(outputPath?: string) {
    this.startTime = Date.now();
    this.outputPath = outputPath ?? null;
  }

  recordStep(step: AgentStep): void {
    this.entries.push({
      timestamp: Date.now() - this.startTime,
      type: 'step',
      data: step,
    });
  }

  recordScreenshot(data: { base64: string; width: number; height: number }): void {
    this.entries.push({
      timestamp: Date.now() - this.startTime,
      type: 'screenshot',
      data: { width: data.width, height: data.height },
    });
  }

  recordPageUpdate(data: { url: string; title: string }): void {
    this.entries.push({
      timestamp: Date.now() - this.startTime,
      type: 'page-update',
      data,
    });
  }

  recordError(error: string): void {
    this.entries.push({
      timestamp: Date.now() - this.startTime,
      type: 'error',
      data: { message: error },
    });
  }

  getEntries(): ReplayEntry[] {
    return [...this.entries];
  }

  async save(outputPath?: string): Promise<string> {
    const target = outputPath ?? this.outputPath;
    if (!target) throw new Error('No output path specified');

    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      version: 1,
      startTime: this.startTime,
      duration: Date.now() - this.startTime,
      entries: this.entries,
    };

    fs.writeFileSync(target, JSON.stringify(data, null, 2));
    logger.info(`Replay saved to ${target}`);
    return target;
  }

  reset(): void {
    this.entries = [];
    this.startTime = Date.now();
  }
}
