import { BridgeServer } from './server';
import { createLogger } from '../logging';
import type { AgentStep } from '../agent/types';

const logger = createLogger('bridge-adapter');

/**
 * Adapts the agent's events to bridge server messages.
 * Allows external clients to observe agent execution.
 */
export class BridgeAdapter {
  private server: BridgeServer;

  constructor(server: BridgeServer) {
    this.server = server;
  }

  onStep(step: AgentStep): void {
    this.server.broadcast('agent:step', step);
  }

  onPageUpdate(data: { url: string; title: string }): void {
    this.server.broadcast('page:update', data);
  }

  onScreenshot(data: { base64: string; width: number; height: number }): void {
    this.server.broadcast('page:screenshot', data);
  }

  onComplete(result: { success: boolean; output: string }): void {
    this.server.broadcast('agent:complete', result);
  }

  onError(error: { message: string }): void {
    this.server.broadcast('agent:error', error);
  }
}
