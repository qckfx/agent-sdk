/**
 * Type definitions for the evaluation system
 */

import type { LLMConfig } from '../../types/llm.js';

/**
 * Represents a test case for evaluating the agent
 */
export interface TestCase {
  /** Unique identifier for the test case */
  id: string;

  /** Human-readable name of the test case */
  name: string;

  /** The instructions to send to the agent */
  instructions: string;

  /** The type of test case */
  type: 'exploration' | 'debugging' | 'implementation' | 'analysis';

  /** Optional function to determine if the test was successful */
  successCriteria?: (result: TestRunWithHistory) => boolean;

  /** Optional function to generate notes about the test run */
  notes?: (result: TestRunWithHistory) => string;
}

/**
 * Represents a system prompt configuration for testing
 */
export interface SystemPromptConfig extends LLMConfig {
  /** Name of the prompt configuration */
  name: string;

  /** The actual system prompt text */
  systemPrompt: string;
}

/**
 * Metrics data collected from a test run
 */
export interface MetricsData {
  /** The name of the test case */
  testCase: string;

  /** The name of the prompt used */
  promptName: string;

  /** Duration of the test in seconds */
  duration: number;

  /** Number of tool calls made during the test */
  toolCalls: number;

  /** Token usage metrics */
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };

  /** Whether the test was successful */
  success: boolean;

  /** Additional notes from the test run */
  notes?: string;
}

/**
 * Comparison between two prompt configurations on a test case
 */
export interface PromptComparisonResult {
  /** The test case that was run */
  testCase: TestCase;

  /** Metrics from the original prompt */
  originalPromptMetrics: MetricsData;

  /** Metrics from the new prompt */
  newPromptMetrics: MetricsData;

  /** Differences between the metrics */
  difference: {
    duration: number;
    durationPercentage: number;
    toolCalls: number;
    toolCallsPercentage: number;
    tokenUsage: {
      input: number;
      output: number;
      total: number;
      inputPercentage: number;
      outputPercentage: number;
      totalPercentage: number;
    };
    successDifference: string;
  };
}

/**
 * Configuration for the evaluation runner
 */
export interface EvaluationConfig {
  /** Directory to save evaluation results */
  outputDir: string;

  /** Original prompt configuration to test */
  originalPrompt: SystemPromptConfig;

  /** New prompt configuration to test */
  newPrompt: SystemPromptConfig;

  /** List of test cases to run */
  testCases: TestCase[];

  /** Whether to use quick mode (subset of test cases) */
  quickMode?: boolean;

  /** Number of times to run each test case (for averaging results) */
  runsPerTest: number;

  /** Whether to enable AI judgment of outputs */
  enableJudging?: boolean;

  /** Number of judgment runs per test */
  judgmentRuns?: number;
}

/**
 * Represents a tool call in the agent's execution history
 */
export interface ToolCallRecord {
  /** The name of the tool that was called */
  tool: string;

  /** The arguments passed to the tool */
  args: Record<string, unknown>;

  /** The result returned by the tool */
  result: string;

  /** When the tool call started */
  startTime: string;

  /** When the tool call ended */
  endTime: string;
}

/**
 * Metadata about the execution
 */
export interface ExecutionMetadata {
  /** The task that was given to the agent */
  task: string;

  /** Additional notes about the execution */
  notes?: string;

  /** Information about the test run */
  runInfo?: {
    /** Unique ID for the test run */
    runId?: string;

    /** Test case ID */
    testId?: string;

    /** Test case name */
    testName?: string;
  };

  /** Information about the agent configuration */
  configInfo?: {
    /** Configuration ID */
    configId?: string;

    /** Configuration name */
    configName?: string;

    /** Model name used */
    modelName?: string;

    /** Prompt name */
    promptName?: string;

    /** Available tools for this configuration */
    availableTools?: string[];
  };
}

/**
 * Represents the execution history of an agent
 */
export interface AgentExecutionHistory {
  /** Metadata about the execution */
  metadata?: ExecutionMetadata;

  /** The tool calls made during execution */
  toolCalls: ToolCallRecord[];

  /** The agent's final response text */
  response?: string;
}

/**
 * Scoring dimensions for AI judge evaluation
 */
export interface JudgmentScores {
  /** Is the solution technically correct? (1-10) */
  correctness: number;

  /** Does it fully address the problem? (1-10) */
  completeness: number;

  /** Is the solution efficient? (1-10) */
  efficiency: number;

  /** Is any code produced clean and readable? (1-10) */
  codeQuality: number;

  /** Are the explanations clear and helpful? (1-10) */
  explanations: number;

  /** Did the agent use appropriate tools? (1-10) */
  toolUsage: number;

  /** Did the agent take a logical approach? (1-10) */
  problemSolving: number;
}

/**
 * Represents a judgment result from the AI judge
 */
export interface JudgmentResult {
  /** Scores across different dimensions */
  scores: JudgmentScores;

  /** Explanations for each dimension's score */
  explanations: Record<string, string>;

  /** Overall assessment of the agent's performance */
  overall: string;

  /** Identified strengths of the agent */
  strengths?: string[];

  /** Identified weaknesses of the agent */
  weaknesses?: string[];

  /** Suggestions for improvement */
  suggestions?: string[];
}

/**
 * Difference between judgment scores
 */
export interface JudgmentDifference {
  /** Differences in each dimension */
  dimensions: {
    [key: string]: {
      difference: number;
      percentageDifference: number;
    };
  };

  /** Overall difference score */
  overallDifference: number;

  /** Overall percentage difference */
  overallPercentageDifference: number;
}

/**
 * Comparison of judgment results between different runs
 */
export interface JudgmentComparisonResult {
  /** Judgment result from the first run */
  judgmentA: JudgmentResult;

  /** Judgment result from the second run */
  judgmentB: JudgmentResult;

  /** Analysis of the differences */
  difference: JudgmentDifference;

  /** Textual comparison analysis */
  analysis: string;
}

/**
 * Represents a test case with examples for AI judge calibration
 */
export interface TestCaseWithExamples extends TestCase {
  /** Categories this test case belongs to */
  categories?: string[];

  /** Examples for calibrating the AI judge */
  examples?: {
    /** Examples of good agent performance */
    good?: {
      /** Execution history showing good behavior */
      executionHistory: AgentExecutionHistory;
    };

    /** Examples of bad agent performance */
    bad?: {
      /** Execution history showing problematic behavior */
      executionHistory: AgentExecutionHistory;
    };
  };
}

/**
 * Represents a test run with execution history
 */
export interface TestRunWithHistory {
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
}
