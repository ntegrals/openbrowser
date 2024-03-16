import type { LanguageModel } from '../model/interface';
import type { AgentResult } from './types';
import { createLogger } from '../logging';

const logger = createLogger('evaluator');

export interface EvaluationResult {
  success: boolean;
  confidence: number;
  reasoning: string;
}

/**
 * Evaluates whether the agent successfully completed its task.
 * Uses an LLM to assess the agent's output and actions.
 */
export class ResultEvaluator {
  constructor(private readonly model: LanguageModel) {}

  async evaluate(
    task: string,
    result: AgentResult,
    finalPageContent?: string,
  ): Promise<EvaluationResult> {
    logger.debug('Evaluating agent result');

    const prompt = this.buildEvalPrompt(task, result, finalPageContent);

    try {
      const response = await this.model.generate([{ role: 'user', content: prompt }], {
        temperature: 0.0,
        maxTokens: 500,
      });

      return this.parseEvalResponse(response.content);
    } catch (err) {
      logger.error('Evaluation failed:', err);
      return {
        success: result.success,
        confidence: 0.5,
        reasoning: 'Evaluation failed, using agent self-report',
      };
    }
  }

  private buildEvalPrompt(
    task: string,
    result: AgentResult,
    pageContent?: string,
  ): string {
    const parts = [
      `Task: ${task}`,
      `Agent reported: ${result.success ? 'success' : 'failure'}`,
      `Steps taken: ${result.totalSteps}`,
      `Agent output: ${result.output.slice(0, 500)}`,
    ];

    if (pageContent) {
      parts.push(`Final page content: ${pageContent.slice(0, 1000)}`);
    }

    parts.push(
      'Evaluate whether the task was completed successfully.',
      'Respond with JSON: { "success": true/false, "confidence": 0.0-1.0, "reasoning": "..." }',
    );

    return parts.join('\n\n');
  }

  private parseEvalResponse(content: string): EvaluationResult {
    try {
      const json = content.match(/\{[\s\S]*\}/)?.[0];
      if (json) {
        return JSON.parse(json);
      }
    } catch {}

    return {
      success: content.toLowerCase().includes('success'),
      confidence: 0.5,
      reasoning: content,
    };
  }
}
