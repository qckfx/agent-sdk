/**
 * A/B testing evaluation runner
 *
 * This runner allows comparing two different agent configurations
 * against the same test cases, including AI judge evaluation.
 */

import path from 'path';
import fs from 'fs';
import { TestCase, TestCaseWithExamples } from '../models/types.js';
import {
  AgentConfiguration,
  ABEvaluationOptions,
  ABEvaluationResult,
  ABTestRunWithHistory,
  ConfigurationComparison,
} from '../models/ab-types.js';
import { SandboxPool } from '../utils/sandbox-pool.js';
import { E2BExecutionAdapter } from '../../utils/E2BExecutionAdapter.js';
import { StorageService, NodeFileSystem } from '../utils/storage.js';
// Import needed for the Required<ABEvaluationResult> type usage
import { analyzeAggregateToolUsage } from '../utils/tool-analysis.js';
import { createLogger, LogLevel } from '../../utils/logger.js';
import { runTestCaseWithHistory } from './test-runner.js';
import { runJudge } from './judge.js';
import { createProviderFromConfig } from '../utils/agent-factory.js';
import { compareConfigurations } from '../utils/comparison.js';
import { generateABReport } from '../utils/reporting.js';
import { createJudgeModelProvider } from '../utils/model-provider.js';
import { createPromptManager } from '../../core/PromptManager.js';
import { createFilteredToolRegistry } from '../utils/tools.js';

// Create a logger for the A/B testing runner
const logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'ABEval',
});

/**
 * Run a test case with a specific configuration
 *
 * @param testCase Test case to run
 * @param config Agent configuration to use
 * @param sandboxAdapter Execution adapter for sandbox operations
 * @returns Test run results with execution history
 */
async function runTestWithConfiguration(
  testCase: TestCase,
  config: AgentConfiguration,
  sandboxAdapter: E2BExecutionAdapter,
  iteration: number,
): Promise<ABTestRunWithHistory> {
  // Create a model provider from the configuration
  const modelProvider = createProviderFromConfig(config);
  const promptManager = createPromptManager(
    config.systemPrompt,
    config.parameters?.temperature || 0.2,
  );

  // Set context information about this test run for logging
  logger.setContext({
    configId: config.id,
    configName: config.name + ` (iteration ${iteration})`,
    testId: testCase.id,
    testName: testCase.name,
  });

  // Create tool registry with filtered tools based on configuration
  const toolRegistry = createFilteredToolRegistry(config.availableTools, config.name);

  // Run the test case and collect execution history
  const run = await runTestCaseWithHistory(
    testCase,
    sandboxAdapter,
    modelProvider,
    promptManager,
    toolRegistry,
  );

  // Add configuration details to the execution history metadata if available
  if (run.executionHistory.metadata) {
    // Set configuration info with properly typed object
    run.executionHistory.metadata.configInfo = {
      configId: config.id,
      configName: config.name,
      modelName: config.model || 'unknown-model',
      promptName: config.name,
      // Add information about available tools if specified in the configuration
      ...(config.availableTools && { availableTools: config.availableTools }),
    };

    // Ensure runInfo includes the AB test run ID
    if (!run.executionHistory.metadata.runInfo) {
      run.executionHistory.metadata.runInfo = {};
    }

    // Add test run information from the A/B eval
    run.executionHistory.metadata.runInfo.runId = `ab-run-${config.id}-${testCase.id}`;
  }

  // Add configuration metadata to the run
  return {
    ...run,
    configId: config.id,
    configName: config.name,
  };
}

/**
 * Run an A/B evaluation comparing two agent configurations
 *
 * @param options Options for the A/B evaluation
 * @returns Evaluation results including all runs and comparison data
 */
export async function runABEvaluation(options: ABEvaluationOptions): Promise<ABEvaluationResult> {
  const {
    configA,
    configB,
    testCases,
    runsPerTest = 3,
    enableJudge = true,
    concurrency = 2,
    _outputDir = path.join(process.cwd(), 'evaluation-results'),
    judgeSystemPrompt,
    useExamples = true,
    storageService = new StorageService(new NodeFileSystem()),
  } = options;

  // Create a model provider adapter for the judge
  const judgeModelProvider = createJudgeModelProvider();

  // Generate a unique run ID
  const runId = `ab-eval-${new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')}`;
  const evalOutputDir = storageService.getEvaluationStorageDir({ runId });

  // Log evaluation configuration
  logger.info(`Starting A/B evaluation with ID: ${runId}`);
  logger.info(`Comparing: ${configA.name} vs ${configB.name}`);
  logger.info(`Test cases: ${testCases.length}`);
  logger.info(`Runs per test: ${runsPerTest}`);
  logger.info(`Concurrency: ${concurrency}`);
  logger.info(`Judge enabled: ${enableJudge}`);

  // Store configurations for future reference
  storageService.storeConfiguration(configA, { runId });
  storageService.storeConfiguration(configB, { runId });

  // Create sandbox pool for parallel execution
  const sandboxPool = new SandboxPool(concurrency);
  await sandboxPool.waitForInitialization();

  const allRuns: ABTestRunWithHistory[] = [];

  try {
    // Create a flat list of all test runs to execute
    const testRuns: { testCase: TestCase; runIndex: number; config: AgentConfiguration }[] = [];

    // Generate test runs for both configurations
    for (const testCase of testCases) {
      // Runs for configuration A
      for (let i = 0; i < runsPerTest; i++) {
        testRuns.push({ testCase, runIndex: i, config: configA });
      }
      // Runs for configuration B
      for (let i = 0; i < runsPerTest; i++) {
        testRuns.push({ testCase, runIndex: i, config: configB });
      }
    }

    // Execute all test runs using the sandbox pool
    const runPromises = testRuns.map(({ testCase, runIndex, config }) =>
      sandboxPool.withConsecutiveOperations(async sandboxInfo => {
        const testName = testCase.name;
        logger.info(
          `Running test "${testName}" with config "${config.name}" (run ${runIndex + 1}/${runsPerTest})`,
        );

        // Run the test case with the specific configuration
        const run = await runTestWithConfiguration(
          testCase,
          config,
          sandboxInfo.executionAdapter,
          runIndex + 1,
        );

        // Store the execution history
        const executionId = storageService.storeExecutionHistory(run.executionHistory, {
          runId,
          testName,
          executionId: `${config.name}-${testName}-${runIndex + 1}`,
        });

        // Return a function to run the judge on the same sandbox
        return async () => {
          if (enableJudge) {
            try {
              // Prepare examples if available
              const testCaseWithExamples = testCase as TestCaseWithExamples;
              const examples =
                useExamples && testCaseWithExamples.examples
                  ? {
                      good: testCaseWithExamples.examples.good?.executionHistory,
                      bad: testCaseWithExamples.examples.bad?.executionHistory,
                    }
                  : undefined;

              // Run the AI judge using the same sandbox
              logger.info(
                `Running judge for test "${testName}" with config "${config.name}" (run ${runIndex + 1}/${runsPerTest})`,
              );
              const judgment = await runJudge(
                run.executionHistory,
                testCase.instructions,
                judgeModelProvider,
                {
                  examples,
                  systemPromptOverride: judgeSystemPrompt,
                },
              );

              if (judgment) {
                // Store the judgment result
                const judgmentId = storageService.storeJudgmentResult(judgment, executionId, {
                  runId,
                  testName,
                });

                return {
                  ...run,
                  executionId,
                  judgment,
                  judgmentId,
                  configId: config.id,
                  configName: config.name,
                };
              }
            } catch (error) {
              logger.error(
                `Failed to run judge for test "${testName}" with config "${config.name}"`,
                error,
              );
            }
          }

          return {
            ...run,
            executionId,
            configId: config.id,
            configName: config.name,
          };
        };
      }),
    );

    // Wait for all test runs to complete
    const results = await Promise.allSettled(runPromises);

    // Process the results
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allRuns.push(result.value);
      } else {
        const { testCase, runIndex, config } = testRuns[index];
        logger.error(
          `Test run failed: ${testCase.name} with config ${config.name} (run ${runIndex + 1})`,
          result.reason,
        );
      }
    });

    // Group runs by configuration and test case
    const runsByConfig: Record<string, ABTestRunWithHistory[]> = {};
    const runsByTest: Record<string, Record<string, ABTestRunWithHistory[]>> = {};

    for (const run of allRuns) {
      const configId = run.configId!;
      const testName = run.testCase.name;

      // Add to configuration group
      if (!runsByConfig[configId]) {
        runsByConfig[configId] = [];
      }
      runsByConfig[configId].push(run);

      // Add to test case group by configuration
      if (!runsByTest[testName]) {
        runsByTest[testName] = {};
      }
      if (!runsByTest[testName][configId]) {
        runsByTest[testName][configId] = [];
      }
      runsByTest[testName][configId].push(run);
    }

    // Calculate average metrics for each configuration
    const averageMetrics: ABEvaluationResult['averageMetrics'] = {};
    const averageJudgment: Required<ABEvaluationResult>['averageJudgment'] = {};
    const toolUsageAnalysis: Required<ABEvaluationResult>['toolUsageAnalysis'] = {};

    for (const configId in runsByConfig) {
      const configRuns = runsByConfig[configId];

      // Calculate average metrics
      averageMetrics[configId] = {
        success: configRuns.filter(run => run.metrics.success).length / configRuns.length,
        duration:
          configRuns.reduce((sum, run) => sum + run.metrics.duration, 0) / configRuns.length,
        toolCalls:
          configRuns.reduce((sum, run) => sum + run.metrics.toolCalls, 0) / configRuns.length,
        tokenUsage: {
          input:
            configRuns.reduce((sum, run) => sum + (run.metrics.tokenUsage?.input || 0), 0) /
            configRuns.length,
          output:
            configRuns.reduce((sum, run) => sum + (run.metrics.tokenUsage?.output || 0), 0) /
            configRuns.length,
          total:
            configRuns.reduce((sum, run) => sum + (run.metrics.tokenUsage?.total || 0), 0) /
            configRuns.length,
        },
      };

      // Add tool usage analysis
      toolUsageAnalysis[configId] = analyzeAggregateToolUsage(configRuns);

      // Calculate average judgment scores if available
      const runsWithJudgment = configRuns.filter(run => run.judgment);
      if (runsWithJudgment.length > 0) {
        const judgmentScores: Record<string, number[]> = {};

        // Collect all judgment scores
        for (const run of runsWithJudgment) {
          if (run.judgment && run.judgment.scores) {
            for (const dimension in run.judgment.scores) {
              if (!judgmentScores[dimension]) {
                judgmentScores[dimension] = [];
              }
              const score = run.judgment.scores[dimension as keyof typeof run.judgment.scores];
              if (typeof score === 'number') {
                judgmentScores[dimension].push(score);
              }
            }
          }
        }

        // Calculate averages
        const avgScores: Record<string, number> = {};
        for (const dimension in judgmentScores) {
          const scores = judgmentScores[dimension];
          avgScores[dimension] = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        }

        // Calculate overall score (average of all dimensions)
        const overall =
          Object.values(avgScores).reduce((sum, score) => sum + score, 0) /
          Object.values(avgScores).length;

        averageJudgment[configId] = {
          ...avgScores,
          overall,
        };
      }
    }

    // Compare configurations if both have judgment scores
    let comparison: ConfigurationComparison | undefined = undefined;
    if (enableJudge && averageJudgment[configA.id] && averageJudgment[configB.id]) {
      // Create a comparison between the configurations
      const comparisonResult = await compareConfigurations(
        configA,
        configB,
        averageJudgment[configA.id],
        averageJudgment[configB.id],
        judgeModelProvider,
      );

      // Store the comparison
      if (comparisonResult) {
        storageService.storeConfigurationComparison(comparisonResult, configA.id, configB.id, {
          runId,
        });
        comparison = comparisonResult;
      }
    }

    // Generate report
    const reportPath = await generateABReport(
      {
        configA: {
          ...configA,
          runs: runsByConfig[configA.id] || [],
          averageMetrics: averageMetrics[configA.id],
          averageJudgment: averageJudgment[configA.id],
        },
        configB: {
          ...configB,
          runs: runsByConfig[configB.id] || [],
          averageMetrics: averageMetrics[configB.id],
          averageJudgment: averageJudgment[configB.id],
        },
        runsByTest,
        comparison,
      },
      path.join(evalOutputDir, 'ab-report.md'),
    );

    logger.info(`A/B evaluation report generated: ${reportPath}`);

    // Generate detailed configuration information
    fs.writeFileSync(
      path.join(evalOutputDir, 'configurations.json'),
      JSON.stringify(
        {
          configA,
          configB,
        },
        null,
        2,
      ),
    );

    // Return the evaluation result
    const result: ABEvaluationResult = {
      runId,
      runs: allRuns,
      runsByConfig,
      averageMetrics,
      toolUsageAnalysis,
      averageJudgment,
      comparison,
      outputDir: evalOutputDir,
    };

    return result;
  } finally {
    // Ensure sandbox pool is properly shut down
    await sandboxPool.shutdown();
  }
}
