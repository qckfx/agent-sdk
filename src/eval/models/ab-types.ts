/**
 * Type definitions for A/B testing with the evaluation system
 */

import { TestCase, JudgmentResult, AgentExecutionHistory, MetricsData } from './types.js';
import { StorageService } from '../utils/storage.js';
import { AggregateToolUsage } from '../utils/tool-analysis.js';

/**
 * Represents a complete agent configuration for evaluation
 */
export interface AgentConfiguration {
  /** Unique identifier for this configuration */
  id: string;

  /** Human-readable name for this configuration */
  name: string;

  /** System prompt configuration */
  systemPrompt: string;

  /** Model to use (e.g., claude-3-opus-20240229) */
  model: string;

  /** Model parameters */
  parameters?: {
    temperature: number;
    topP?: number;
    maxTokens?: number;
    [key: string]: number | string | boolean | null | undefined;
  };

  /**
   * Optional array of tool IDs that this agent configuration has access to.
   * If not provided, the agent will have access to all registered tools.
   * Example: ["bash", "glob", "grep", "ls", "view", "edit"]
   */
  availableTools?: string[];

  /** Additional metadata about this configuration */
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Options for running an A/B evaluation
 */
export interface ABEvaluationOptions {
  /** Configuration A (original/baseline) */
  configA: AgentConfiguration;

  /** Configuration B (new/experimental) */
  configB: AgentConfiguration;

  /** Test cases to run for both configurations */
  testCases: TestCase[];

  /** Number of runs per test case for each configuration */
  runsPerTest?: number;

  /** Whether to enable AI judge evaluation */
  enableJudge?: boolean;

  /** Number of parallel test executions */
  concurrency?: number;

  /** Directory to store results */
  outputDir?: string;

  /** Custom system prompt for the judge */
  judgeSystemPrompt?: string;

  /** Whether to use good/bad examples for calibrating the judge */
  useExamples?: boolean;

  /** Storage service for persisting evaluation data */
  storageService?: StorageService;

  /** Additional options */
  [key: string]: unknown;
}

/**
 * Results of an A/B evaluation
 */
export interface ABEvaluationResult {
  /** Unique run ID */
  runId: string;

  /** All individual test runs */
  runs: ABTestRunWithHistory[];

  /** Runs grouped by configuration */
  runsByConfig: {
    [configId: string]: ABTestRunWithHistory[];
  };

  /** Average metrics by configuration */
  averageMetrics: {
    [configId: string]: {
      success: number;
      duration: number;
      toolCalls: number;
      tokenUsage: {
        input: number;
        output: number;
        total: number;
      };
    };
  };

  /** Tool usage analysis by configuration */
  toolUsageAnalysis?: {
    [configId: string]: AggregateToolUsage;
  };

  /** Average judgment scores by configuration */
  averageJudgment?: {
    [configId: string]: {
      [dimension: string]: number;
      overall: number;
    };
  };

  /** Direct comparison between configurations */
  comparison?: ConfigurationComparison;

  /** Output directory */
  outputDir: string;
}

/**
 * Extended test run with configuration information
 */
export interface ABTestRunWithHistory {
  /** The test case that was run */
  testCase: TestCase;

  /** Metrics from the test run */
  metrics: MetricsData;

  /** The execution history of the agent */
  executionHistory: AgentExecutionHistory;

  /** ID of the stored execution */
  executionId?: string;

  /** Judgment result if available */
  judgment?: JudgmentResult;

  /** ID of the stored judgment */
  judgmentId?: string;

  /** Configuration ID this run was executed with */
  configId?: string;

  /** Configuration name this run was executed with */
  configName?: string;
}

/**
 * Result of comparing two configurations
 */
export interface ConfigurationComparison {
  /** Which configuration performed better ("A", "B", or "tie") */
  winner: string;

  /** Detailed analysis of the comparison */
  analysis: string;

  /** Score differences for each dimension */
  scoreDifferences: {
    [dimension: string]: number;
  };

  /** Overall percentage improvement */
  overallImprovement?: number;

  /** Most significant dimensions of difference */
  significantDimensions?: {
    name: string;
    difference: number;
    percentageChange: number;
  }[];
}
