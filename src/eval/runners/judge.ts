/**
 * Judge runner for evaluating agent performance using AI judging
 */

import { JudgmentResult, AgentExecutionHistory } from '../models/types.js';
import { createJudgingPrompt } from '../utils/prompts.js';
import { createLogger, LogLevel } from '../../utils/logger.js';

// Create a logger for the judge runner
const logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'JudgeRunner',
  formatOptions: {
    showTimestamp: true,
    showPrefix: true,
    colors: true
  }
});

/**
 * Interface for a model provider that can process queries
 */
export interface ModelProvider {
  processQuery: (
    prompt: string, 
    options: ProcessQueryOptions
  ) => Promise<{ response: string | null }>;
}

/**
 * Options for processing a query through a model provider
 */
export interface ProcessQueryOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Options for running a judge evaluation
 */
export interface JudgeOptions {
  examples?: {
    good?: AgentExecutionHistory;
    bad?: AgentExecutionHistory;
  };
  systemPromptOverride?: string;
}

/**
 * Result from a comparison between two executions
 */
export interface ComparisonResult {
  judgmentA: JudgmentResult | null;
  judgmentB: JudgmentResult | null;
  comparison: string | null;
}

/**
 * Extract JSON from a string containing JSON blocks
 * @param output String that may contain JSON blocks
 * @returns Extracted JSON string or null if not found
 */
export function extractJsonFromString(output: string): string | null {
  // Look for JSON block in the output using regex
  const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/) || 
                    output.match(/{[\s\S]*}/);
  
  if (!jsonMatch) {
    return null;
  }
  
  // Extract the JSON content
  return (jsonMatch[1] || jsonMatch[0]).trim();
}

/**
 * Validate that an object meets the requirements for a judgment result
 * @param result Object to validate
 * @returns Whether the object is a valid judgment result
 */
export function isValidJudgmentResult(result: Record<string, unknown>): boolean {
  if (!result) return false;
  if (typeof result !== 'object') return false;
  if (!result.scores || typeof result.scores !== 'object') return false;
  if (!result.explanations || typeof result.explanations !== 'object') return false;
  if (!result.overall || typeof result.overall !== 'string') return false;
  if (!Array.isArray(result.strengths)) return false;
  if (!Array.isArray(result.weaknesses)) return false;
  
  return true;
}

/**
 * Parse the judgment output from the LLM.
 * The output should be a JSON string with scores and explanations.
 * @param output Raw output from the LLM
 * @returns Parsed judgment result or null if parsing failed
 */
export function parseJudgmentOutput(output: string): JudgmentResult | null {
  try {
    const jsonContent = extractJsonFromString(output);
    
    if (!jsonContent) {
      logger.error('Failed to find JSON in judge output');
      return null;
    }
    
    // Parse the JSON content
    const result = JSON.parse(jsonContent);
    
    // Validate the structure
    if (!isValidJudgmentResult(result)) {
      logger.error('Invalid judgment result structure', result);
      return null;
    }
    
    return result as JudgmentResult;
  } catch (error) {
    logger.error('Failed to parse judgment output', error);
    return null;
  }
}

/**
 * Create a judging prompt for the given execution history
 * @param task The task that was given to the agent
 * @param executionHistory The agent's execution history
 * @param options Additional options for the judge
 * @returns The prompt for the judge
 */
export function createJudgePrompt(
  task: string,
  executionHistory: AgentExecutionHistory,
  options: JudgeOptions = {}
): string {
  return createJudgingPrompt({
    task,
    executionHistory,
    examples: options.examples,
    systemPromptOverride: options.systemPromptOverride,
  });
}

/**
 * Process the model's response to extract a judgment result
 * @param modelResponse The response from the model
 * @returns Parsed judgment result or null if parsing failed
 */
export function processJudgeResponse(modelResponse: string | null): JudgmentResult | null {
  if (!modelResponse) {
    logger.error('No response from judge model');
    return null;
  }
  
  const judgmentResult = parseJudgmentOutput(modelResponse);
  
  if (!judgmentResult) {
    logger.error('Failed to parse judgment result');
    return null;
  }
  
  return judgmentResult;
}

/**
 * Run the AI judge to evaluate an agent's execution history.
 * @param executionHistory The agent's execution history
 * @param task The task that was given to the agent
 * @param modelProvider The model provider to use for judging
 * @param options Additional options for the judge
 * @returns The judgment result or null if judging failed
 */
export async function runJudge(
  executionHistory: AgentExecutionHistory,
  task: string,
  modelProvider: ModelProvider,
  options: JudgeOptions = {}
): Promise<JudgmentResult | null> {
  try {
    // Create the judging prompt
    const prompt = createJudgePrompt(task, executionHistory, options);
    
    // Run the judge model
    logger.info('Running AI judge evaluation');
    const result = await modelProvider.processQuery(prompt, {
      temperature: 0.2,  // Low temperature for more consistent judgments
      maxTokens: 4000,   // Ensure enough tokens for detailed analysis
    });
    
    // Process the response
    return processJudgeResponse(result.response);
  } catch (error) {
    logger.error('Error running judge', error);
    return null;
  }
}

/**
 * Create a comparison prompt for two judgment results
 * @param judgmentA First judgment result
 * @param judgmentB Second judgment result
 * @returns Comparison prompt
 */
export function createComparisonPrompt(
  judgmentA: JudgmentResult,
  judgmentB: JudgmentResult
): string {
  return `
I need you to compare two different AI agent executions that have been judged.

EXECUTION A JUDGMENT:
${JSON.stringify(judgmentA, null, 2)}

EXECUTION B JUDGMENT:
${JSON.stringify(judgmentB, null, 2)}

Compare these two executions and explain which one performed better overall and why.
Include specific comparisons across each dimension scored (correctness, completeness, etc.).
Clearly state which execution is superior and by how much.

Format your response as a markdown report with clear section headings.
`;
}

/**
 * Compare two execution histories using the AI judge.
 * @param executionA First execution to compare, or a run with existing judgment
 * @param executionB Second execution to compare, or a run with existing judgment
 * @param modelProvider The model provider to use for judging
 * @param options Additional options for the judge
 * @returns Comparison result
 */
export async function compareWithJudge(
  executionA: { history: AgentExecutionHistory; task: string; judgment?: JudgmentResult },
  executionB: { history: AgentExecutionHistory; task: string; judgment?: JudgmentResult },
  modelProvider: ModelProvider,
  options: JudgeOptions = {}
): Promise<ComparisonResult> {
  let judgmentA: JudgmentResult | null;
  let judgmentB: JudgmentResult | null;
  
  // Use existing judgments if provided, otherwise run the judge
  if (executionA.judgment) {
    logger.info('Using existing judgment for execution A');
    judgmentA = executionA.judgment;
  } else {
    // Run the judge on execution A
    logger.info('Running AI judge evaluation for execution A');
    judgmentA = await runJudge(
      executionA.history, 
      executionA.task, 
      modelProvider,
      options
    );
  }
  
  if (executionB.judgment) {
    logger.info('Using existing judgment for execution B');
    judgmentB = executionB.judgment;
  } else {
    // Run the judge on execution B
    logger.info('Running AI judge evaluation for execution B');
    judgmentB = await runJudge(
      executionB.history, 
      executionB.task, 
      modelProvider,
      options
    );
  }
  
  // If either judgment failed, return what we have
  if (!judgmentA || !judgmentB) {
    return {
      judgmentA,
      judgmentB,
      comparison: null,
    };
  }
  
  // Create and run the comparison
  try {
    logger.info('Running judgment comparison');
    const comparisonPrompt = createComparisonPrompt(judgmentA, judgmentB);
    
    const comparisonResult = await modelProvider.processQuery(comparisonPrompt, {
      temperature: 0.2,
      maxTokens: 2000,
    });
    
    return {
      judgmentA,
      judgmentB,
      comparison: comparisonResult.response || null,
    };
  } catch (error) {
    logger.error('Error comparing judgments', error);
    return {
      judgmentA,
      judgmentB,
      comparison: null,
    };
  }
}