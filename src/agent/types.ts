import type { ToolCall } from '../model/types';

export interface AgentStep {
  stepNumber: number;
  thought?: string;
  action?: ToolCall;
  result?: string;
  error?: string;
  timestamp: number;
}

export interface AgentResult {
  success: boolean;
  output: string;
  steps: AgentStep[];
  totalSteps: number;
  duration: number;
}

export interface AgentOptions {
  task: string;
  maxSteps?: number;
  systemPrompt?: string;
}
