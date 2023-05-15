import type { LanguageModel } from '../model/interface';
import type { ToolDefinition } from '../model/types';
import { ConversationManager } from './conversation/service';
import { StallDetector } from './stall-detector';
import { InstructionBuilder } from './instructions';
import type { AgentStep, AgentResult, AgentOptions } from './types';
import { createLogger } from '../logging';

const logger = createLogger('agent');

/**
 * The core agent loop. Takes a task, uses an LLM to decide actions,
 * and executes them against the browser viewport.
 */
export class Agent {
  private readonly model: LanguageModel;
  private readonly conversation: ConversationManager;
  private readonly stallDetector: StallDetector;
  private readonly instructions: InstructionBuilder;
  private readonly maxSteps: number;
  private steps: AgentStep[] = [];
  private running = false;

  constructor(
    model: LanguageModel,
    options: {
      maxSteps?: number;
      systemPrompt?: string;
    } = {},
  ) {
    this.model = model;
    this.maxSteps = options.maxSteps ?? 100;
    this.conversation = new ConversationManager({
      systemPrompt: options.systemPrompt,
    });
    this.stallDetector = new StallDetector();
    this.instructions = new InstructionBuilder();
  }

  /**
   * Run the agent on a task.
   */
  async run(options: AgentOptions): Promise<AgentResult> {
    const start = Date.now();
    this.running = true;
    this.steps = [];
    this.stallDetector.reset();

    logger.info(`Starting agent task: ${options.task}`);

    this.instructions.withTask(options.task);
    if (options.systemPrompt) {
      this.instructions.setSection('role', options.systemPrompt);
    }

    // Add initial user message
    this.conversation.addMessage({
      role: 'user',
      content: options.task,
    });

    let stepNumber = 0;
    let lastOutput = '';

    while (this.running && stepNumber < (options.maxSteps ?? this.maxSteps)) {
      stepNumber++;
      logger.debug(`Step ${stepNumber}`);

      try {
        const response = await this.model.generate(
          this.conversation.getMessages(),
        );

        const step: AgentStep = {
          stepNumber,
          thought: response.content,
          timestamp: Date.now(),
        };

        this.steps.push(step);

        // Update token tracking
        if (response.usage) {
          this.conversation.updateTokenCount(response.usage.totalTokens);
        }

        this.conversation.addMessage({
          role: 'assistant',
          content: response.content,
        });

        lastOutput = response.content;

        // Check for stall
        if (this.stallDetector.recordAction(response.content.slice(0, 100))) {
          logger.warn('Agent stalled, stopping');
          break;
        }

        // Check for finish signal
        if (response.finishReason === 'stop' || response.content.includes('[DONE]')) {
          break;
        }
      } catch (error) {
        const step: AgentStep = {
          stepNumber,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        };
        this.steps.push(step);
        logger.error(`Step ${stepNumber} failed:`, error);

        // Don't break on error, let the agent recover
        this.conversation.addMessage({
          role: 'user',
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    this.running = false;

    return {
      success: stepNumber < (options.maxSteps ?? this.maxSteps),
      output: lastOutput,
      steps: this.steps,
      totalSteps: stepNumber,
      duration: Date.now() - start,
    };
  }

  /**
   * Stop the agent loop.
   */
  stop(): void {
    this.running = false;
  }
}
