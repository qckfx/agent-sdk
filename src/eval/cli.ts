/**
 * A/B Testing CLI
 * 
 * A simplified CLI interface for running A/B prompt evaluations
 */

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { ABEvaluationOptions } from './models/ab-types.js';
import { runABEvaluation } from './runners/ab-runner.js';
import { testCases, getQuickTestCases } from './models/test-cases.js';
import { getToolFriendlyName } from './utils/tools.js';

/**
 * Setup the evaluation CLI
 */
export function setupEvalCLI(): Command {
  // Create a command line interface
  const program = new Command();
  
  program
    .name('eval')
    .description('qckfx Agent Evaluation CLI')
    .version('1.0.0');
  
  // Add the eval command for A/B testing
  program
    .command('run')
    .description('Run A/B testing evaluation')
    .option('-c, --config <path>', 'Path to a custom A/B test configuration file')
    .option('-o, --output <dir>', 'Directory to save results (default: ./evaluation-results)')
    .option('-r, --runs <number>', 'Number of runs per test case (default: 3)')
    .option('--concurrency <number>', 'Number of concurrent test executions (default: 2)')
    .option('--quick', 'Use a smaller subset of test cases for quicker evaluation')
    .option('--no-judge', 'Disable AI judge evaluation')
    .action(async (options) => {
      try {
        let config;
        
        // Load either the provided config or the default one
        if (options.config) {
          console.log(chalk.blue(`Loading custom configuration from ${options.config}`));
          
          if (!fs.existsSync(options.config)) {
            console.error(chalk.red(`Configuration file not found: ${options.config}`));
            process.exit(1);
          }
          
          config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
        } else {
          // Use the default config
          const defaultConfigPath = path.join(__dirname, './examples/ab-config-example.json');
          console.log(chalk.blue(`Loading default configuration from ${defaultConfigPath}`));
          
          if (!fs.existsSync(defaultConfigPath)) {
            console.error(chalk.red(`Default configuration file not found. Please provide a custom config with --config.`));
            process.exit(1);
          }
          
          config = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
        }
        
        // Validate the configuration
        if (!config.configA || !config.configB) {
          console.error(chalk.red('Invalid configuration: must include configA and configB configurations'));
          process.exit(1);
        }
        
        // Handle the case where test cases might be in the config or use default ones
        let evaluationTestCases = config.testCases;
        if (!evaluationTestCases || evaluationTestCases.length === 0) {
          // Use all test cases or quick mode if requested
          evaluationTestCases = options.quick ? getQuickTestCases() : testCases;
          console.log(chalk.yellow(`No test cases in config, using ${options.quick ? 'quick' : 'all'} built-in test cases`));
        }

        // Set default values
        const abOptions: ABEvaluationOptions = {
          configA: config.configA,
          configB: config.configB,
          testCases: evaluationTestCases,
          runsPerTest: options.runs ? parseInt(options.runs, 10) : 3,
          enableJudge: options.judge !== false,
          concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 2,
          outputDir: options.output || path.join(process.cwd(), 'evaluation-results'),
        };
        
        console.log(chalk.blue(`Starting A/B evaluation with ${abOptions.testCases.length} test cases`));
        console.log(chalk.blue(`Comparing: ${config.configA.name} vs ${config.configB.name}`));
        console.log(chalk.blue(`Runs per test: ${abOptions.runsPerTest}`));
        console.log(chalk.blue(`Concurrency: ${abOptions.concurrency}`));
        console.log(chalk.blue(`Judge enabled: ${abOptions.enableJudge}`));
        
        // Run the evaluation
        const result = await runABEvaluation(abOptions);
        
        console.log(chalk.green(`A/B evaluation completed successfully!`));
        console.log(chalk.green(`Total runs: ${result.runs.length}`));
        console.log(chalk.green(`Report: ${path.join(result.outputDir, 'ab-report.md')}`));
        
        // Print tool usage summary if available
        if (result.toolUsageAnalysis) {
          console.log(chalk.blue.bold(`\nTool Usage Summary:`));
          
          const usageA = result.toolUsageAnalysis[config.configA.id];
          const usageB = result.toolUsageAnalysis[config.configB.id];
          
          if (usageA && usageB) {
            console.log(`${config.configA.name}: ${usageA.avgTotal.toFixed(1)} tools/run (${usageA.avgUniqueTools.toFixed(1)} unique)`);
            console.log(`${config.configB.name}: ${usageB.avgTotal.toFixed(1)} tools/run (${usageB.avgUniqueTools.toFixed(1)} unique)`);
            
            // Show top 3 tools by usage for each config
            const topToolsA = Object.entries(usageA.avgCounts)
              .sort(([, countA], [, countB]) => countB - countA)
              .slice(0, 3);
              
            const topToolsB = Object.entries(usageB.avgCounts)
              .sort(([, countA], [, countB]) => countB - countA)
              .slice(0, 3);
            
            if (topToolsA.length > 0) {
              console.log(`\n${config.configA.name} top tools: ${topToolsA.map(([tool, count]) => 
                `${getToolFriendlyName(tool)} (${count.toFixed(1)})`).join(', ')}`);
            }
            
            if (topToolsB.length > 0) {
              console.log(`${config.configB.name} top tools: ${topToolsB.map(([tool, count]) => 
                `${getToolFriendlyName(tool)} (${count.toFixed(1)})`).join(', ')}`);
            }
          }
        }
        
        // Display summary if judging was enabled
        if (abOptions.enableJudge && result.averageJudgment) {
          console.log(chalk.yellow('\nJudgment Summary:'));
          
          // Display average scores for both configurations
          const configAName = config.configA.name;
          const configBName = config.configB.name;
          
          console.log(chalk.cyan(`\n${configAName} average scores:`));
          for (const [dimension, score] of Object.entries(result.averageJudgment[config.configA.id])) {
            if (dimension === 'overall') continue;
            console.log(`  ${dimension}: ${(score as number).toFixed(2)}`);
          }
          
          console.log(chalk.cyan(`\n${configBName} average scores:`));
          for (const [dimension, score] of Object.entries(result.averageJudgment[config.configB.id])) {
            if (dimension === 'overall') continue;
            console.log(`  ${dimension}: ${(score as number).toFixed(2)}`);
          }
          
          // Display comparison result if available
          if (result.comparison) {
            console.log(chalk.green('\nComparison Result:'));
            console.log(`  Winner: ${result.comparison.winner === 'A' ? configAName : (result.comparison.winner === 'B' ? configBName : 'Tie')}`);
            
            if (result.comparison.overallImprovement) {
              const improvement = result.comparison.overallImprovement;
              console.log(`  Overall Improvement: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
            }
          }
        }
      } catch (error) {
        console.error(chalk.red('A/B evaluation failed:'), error);
        process.exit(1);
      }
    });

  // Add a list command to show available test cases
  program
    .command('list')
    .description('List available test cases')
    .option('--quiet', 'Display only test IDs and names without details')
    .action((options) => {
      console.log(chalk.yellow('Available test cases:'));
      
      testCases.forEach((testCase, index) => {
        console.log(`${index + 1}. ${chalk.cyan(testCase.name)} (${chalk.gray(testCase.id)})`);
        
        if (!options.quiet) {
          console.log(`   Type: ${testCase.type || 'unspecified'}`);
          console.log(`   Instructions: ${testCase.instructions.slice(0, 100) + '...'}`);
          console.log();
        }
      });
    });

  return program;
}

// Export the setup function as the default export
export default setupEvalCLI;