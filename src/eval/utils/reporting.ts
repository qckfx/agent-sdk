/**
 * Report generation functions for A/B testing
 */

import fs from 'fs';
import path from 'path';
import { ABTestRunWithHistory, ConfigurationComparison } from '../models/ab-types.js';
import { createJudgeModelProvider } from './model-provider.js';
import { 
  analyzeAggregateToolUsage, 
  generateToolUsageComparisonTable,
  generateToolPatternsSection
} from './tool-analysis.js';
import { ProcessQueryOptions } from '../runners/judge.js';

/**
 * Generate a comprehensive A/B testing report
 * 
 * @param data Comparison data to include in the report
 * @param outputPath File path to write the report to
 * @returns Path to the generated report
 */
export async function generateABReport(
  data: {
    configA: {
      id: string;
      name: string;
      runs: ABTestRunWithHistory[];
      averageMetrics: {
        success: number;
        duration: number;
        toolCalls: number;
        tokenUsage: {
          input: number;
          output: number;
          total: number;
        };
      };
      averageJudgment?: Record<string, number | string | unknown>;
    };
    configB: {
      id: string;
      name: string;
      runs: ABTestRunWithHistory[];
      averageMetrics: {
        success: number;
        duration: number;
        toolCalls: number;
        tokenUsage: {
          input: number;
          output: number;
          total: number;
        };
      };
      averageJudgment?: Record<string, number | string | unknown>;
    };
    runsByTest: Record<string, Record<string, ABTestRunWithHistory[]>>;
    comparison?: ConfigurationComparison;
  },
  outputPath: string
): Promise<string> {
  const { configA, configB, runsByTest, comparison } = data;
  
  // Create a model provider for summarizing results
  const judgeModelProvider = createJudgeModelProvider();
  
  // Ensure the output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Start building the report
  let markdown = `# A/B Testing Evaluation Report\n\n`;
  markdown += `Generated: ${new Date().toLocaleString()}\n\n`;
  
  // Add configuration information
  markdown += `## Configurations Compared\n\n`;
  markdown += `### Configuration A: ${configA.name}\n\n`;
  markdown += formatConfigDetails(configA);
  markdown += `\n### Configuration B: ${configB.name}\n\n`;
  markdown += formatConfigDetails(configB);
  markdown += `\n`;
  
  // Add overall summary
  markdown += `## Overall Results\n\n`;
  
  // Success rates
  markdown += `### Success Rates\n\n`;
  markdown += `| Configuration | Success Rate | Avg Duration (s) | Avg Tool Calls | Avg Token Usage |\n`;
  markdown += `|---------------|--------------|------------------|----------------|----------------|\n`;
  markdown += `| ${configA.name} | ${(configA.averageMetrics.success * 100).toFixed(1)}% | ${configA.averageMetrics.duration.toFixed(2)} | ${configA.averageMetrics.toolCalls.toFixed(1)} | ${configA.averageMetrics.tokenUsage.total.toFixed(0)} |\n`;
  markdown += `| ${configB.name} | ${(configB.averageMetrics.success * 100).toFixed(1)}% | ${configB.averageMetrics.duration.toFixed(2)} | ${configB.averageMetrics.toolCalls.toFixed(1)} | ${configB.averageMetrics.tokenUsage.total.toFixed(0)} |\n\n`;
  
  // Add tool usage section
  markdown += generateToolUsageSection(data);
  
  // Add judgment scores if available
  if (configA.averageJudgment && configB.averageJudgment) {
    markdown += `### AI Judge Evaluation\n\n`;
    markdown += `| Dimension | ${configA.name} | ${configB.name} | Difference |\n`;
    markdown += `|-----------|------------|------------|------------|\n`;
    
    // Get all dimensions from both judgments
    const dimensions = Array.from(
      new Set([
        ...Object.keys(configA.averageJudgment),
        ...Object.keys(configB.averageJudgment)
      ])
    ).filter(d => d !== 'overall');
    
    // Add a row for each dimension
    for (const dimension of dimensions) {
      const scoreA = configA.averageJudgment[dimension] || 'N/A';
      const scoreB = configB.averageJudgment[dimension] || 'N/A';
      const difference = typeof scoreA === 'number' && typeof scoreB === 'number' 
        ? scoreB - scoreA 
        : 'N/A';
      
      const diffText = typeof difference === 'number'
        ? `${difference > 0 ? '+' : ''}${difference.toFixed(2)}`
        : difference;
      
      markdown += `| ${dimension} | ${typeof scoreA === 'number' ? scoreA.toFixed(2) : scoreA} | ${typeof scoreB === 'number' ? scoreB.toFixed(2) : scoreB} | ${diffText} |\n`;
    }
    
    // Add overall scores
    const overallA = configA.averageJudgment.overall || 'N/A';
    const overallB = configB.averageJudgment.overall || 'N/A';
    const overallDiff = typeof overallA === 'number' && typeof overallB === 'number'
      ? overallB - overallA
      : 'N/A';
    
    const overallDiffText = typeof overallDiff === 'number'
      ? `${overallDiff > 0 ? '+' : ''}${overallDiff.toFixed(2)}`
      : overallDiff;
    
    markdown += `| **Overall** | **${typeof overallA === 'number' ? overallA.toFixed(2) : overallA}** | **${typeof overallB === 'number' ? overallB.toFixed(2) : overallB}** | **${overallDiffText}** |\n\n`;
    
    // Get summaries of overall strengths and weaknesses
    const allRunsA = configA.runs.filter(r => r.judgment);
    const allRunsB = configB.runs.filter(r => r.judgment);
    
    if (allRunsA.length > 0 && allRunsB.length > 0) {
      // Summarize overall strengths and weaknesses
      const strengthSummaryA = await summarizeJudgmentProperty(allRunsA, 'strengths', judgeModelProvider, configA.name);
      const strengthSummaryB = await summarizeJudgmentProperty(allRunsB, 'strengths', judgeModelProvider, configB.name);
      const weaknessSummaryA = await summarizeJudgmentProperty(allRunsA, 'weaknesses', judgeModelProvider, configA.name);
      const weaknessSummaryB = await summarizeJudgmentProperty(allRunsB, 'weaknesses', judgeModelProvider, configB.name);
      
      markdown += `### Overall Agent Characteristics\n\n`;
      
      markdown += `**Key Strengths:**\n\n`;
      markdown += `- ${configA.name}: ${strengthSummaryA}\n\n`;
      markdown += `- ${configB.name}: ${strengthSummaryB}\n\n`;
      
      markdown += `**Key Weaknesses:**\n\n`;
      markdown += `- ${configA.name}: ${weaknessSummaryA}\n\n`;
      markdown += `- ${configB.name}: ${weaknessSummaryB}\n\n`;
    }
  }
  
  // Add comparison results if available
  if (comparison) {
    markdown += `### Configuration Comparison\n\n`;
    markdown += `**Winner: ${comparison.winner === 'A' ? configA.name : (comparison.winner === 'B' ? configB.name : 'Tie')}**\n\n`;
    
    if (comparison.analysis) {
      markdown += `**Analysis:**\n\n${comparison.analysis}\n\n`;
    }
    
    if (comparison.significantDimensions && comparison.significantDimensions.length > 0) {
      markdown += `**Most Significant Differences:**\n\n`;
      markdown += `| Dimension | Difference | % Change |\n`;
      markdown += `|-----------|------------|----------|\n`;
      
      for (const dim of comparison.significantDimensions) {
        markdown += `| ${dim.name} | ${dim.difference > 0 ? '+' : ''}${dim.difference.toFixed(2)} | ${dim.percentageChange > 0 ? '+' : ''}${dim.percentageChange.toFixed(1)}% |\n`;
      }
      markdown += '\n';
    }
  }
  
  // Add per-test case details
  markdown += `## Test Case Details\n\n`;
  
  let testIndex = 1;
  for (const testName in runsByTest) {
    const testData = runsByTest[testName];
    const runsA = testData[configA.id] || [];
    const runsB = testData[configB.id] || [];
    
    markdown += `### ${testIndex}. ${testName}\n\n`;
    testIndex++;
    
    if (runsA.length > 0) {
      const testCase = runsA[0].testCase;
      markdown += `**Task:** ${testCase.instructions}\n\n`;
    }
    
    // Add success rate for this test
    const successRateA = runsA.length > 0 ? runsA.filter(r => r.metrics.success).length / runsA.length : 0;
    const successRateB = runsB.length > 0 ? runsB.filter(r => r.metrics.success).length / runsB.length : 0;
    
    markdown += `**Success Rate:**\n\n`;
    markdown += `- ${configA.name}: ${(successRateA * 100).toFixed(1)}%\n`;
    markdown += `- ${configB.name}: ${(successRateB * 100).toFixed(1)}%\n\n`;
    
    // Add judgment results if available
    const judgedRunsA = runsA.filter(r => r.judgment);
    const judgedRunsB = runsB.filter(r => r.judgment);
    
    if (judgedRunsA.length > 0 && judgedRunsB.length > 0) {
      markdown += `**Judgment Results:**\n\n`;
      
      // Calculate average scores for this test
      const avgScoresA = calculateAverageScores(judgedRunsA);
      const avgScoresB = calculateAverageScores(judgedRunsB);
      
      // Get all dimensions
      const dimensions = new Set<string>();
      
      for (const run of judgedRunsA) {
        if (run.judgment && run.judgment.scores) {
          Object.keys(run.judgment.scores).forEach(dim => dimensions.add(dim));
        }
      }
      
      for (const run of judgedRunsB) {
        if (run.judgment && run.judgment.scores) {
          Object.keys(run.judgment.scores).forEach(dim => dimensions.add(dim));
        }
      }
      
      // Create a comparison table
      markdown += `| Dimension | ${configA.name} | ${configB.name} | Difference |\n`;
      markdown += `|-----------|------------|------------|------------|\n`;
      
      for (const dimension of dimensions) {
        const scoreA = avgScoresA[dimension] || 0;
        const scoreB = avgScoresB[dimension] || 0;
        const difference = scoreB - scoreA;
        
        markdown += `| ${dimension} | ${scoreA.toFixed(2)} | ${scoreB.toFixed(2)} | ${difference > 0 ? '+' : ''}${difference.toFixed(2)} |\n`;
      }
      
      markdown += '\n';
      
      // Get AI-generated summaries for strengths and weaknesses
      const strengthSummaryA = await summarizeJudgmentProperty(judgedRunsA, 'strengths', judgeModelProvider, configA.name);
      const strengthSummaryB = await summarizeJudgmentProperty(judgedRunsB, 'strengths', judgeModelProvider, configB.name);
      const weaknessSummaryA = await summarizeJudgmentProperty(judgedRunsA, 'weaknesses', judgeModelProvider, configA.name);
      const weaknessSummaryB = await summarizeJudgmentProperty(judgedRunsB, 'weaknesses', judgeModelProvider, configB.name);
      
      markdown += `**Strengths:**\n\n`;
      markdown += `- ${configA.name}: ${strengthSummaryA}\n\n`;
      markdown += `- ${configB.name}: ${strengthSummaryB}\n\n`;
      
      markdown += `**Weaknesses:**\n\n`;
      markdown += `- ${configA.name}: ${weaknessSummaryA}\n\n`;
      markdown += `- ${configB.name}: ${weaknessSummaryB}\n\n`;
    }
    
    // Add separator between test cases
    markdown += `---\n\n`;
  }
  
  // Write the report to the output file
  fs.writeFileSync(outputPath, markdown);
  return outputPath;
}

/**
 * Generate a tool usage comparison section for the report
 * 
 * @param data Report data containing runs from both configurations
 * @returns Markdown section for tool usage comparison
 */
function generateToolUsageSection(data: {
  configA: {
    id: string;
    name: string;
    runs: ABTestRunWithHistory[];
    availableTools?: string[] | string;
  };
  configB: {
    id: string;
    name: string;
    runs: ABTestRunWithHistory[];
    availableTools?: string[] | string;
  };
}): string {
  // Extract runs from configurations
  const runsA = data.configA.runs || [];
  const runsB = data.configB.runs || [];
  
  // Analyze tool usage for each configuration
  const toolUsageA = analyzeAggregateToolUsage(runsA);
  const toolUsageB = analyzeAggregateToolUsage(runsB);
  
  // Skip if no tools were used
  if (Object.keys(toolUsageA.avgCounts).length === 0 && Object.keys(toolUsageB.avgCounts).length === 0) {
    return '';
  }
  
  let section = `\n## Tool Usage Analysis\n\n`;
  section += `This section analyzes how the two configurations used tools during task execution.\n\n`;
  
  // Add tool availability information
  section += `### Tool Availability\n\n`;
  
  const toolsA = data.configA.availableTools ? 
    (Array.isArray(data.configA.availableTools) ? data.configA.availableTools.join(', ') : String(data.configA.availableTools)) : 
    'all tools';
    
  const toolsB = data.configB.availableTools ? 
    (Array.isArray(data.configB.availableTools) ? data.configB.availableTools.join(', ') : String(data.configB.availableTools)) : 
    'all tools';
  
  section += `- **${data.configA.name}** had access to: ${toolsA}\n`;
  section += `- **${data.configB.name}** had access to: ${toolsB}\n\n`;
  
  // Add tool usage comparison table
  section += `### Tool Usage Frequency\n\n`;
  section += generateToolUsageComparisonTable(
    toolUsageA,
    toolUsageB,
    data.configA.name,
    data.configB.name
  );
  
  // Add tool patterns section
  section += `\n`;
  section += generateToolPatternsSection(
    toolUsageA,
    toolUsageB,
    data.configA.name,
    data.configB.name
  );
  
  // Generate additional insights
  section += `\n### Tool Usage Insights\n\n`;
  
  // Generate insights based on the tool usage patterns
  const uniqueToolsA = new Set(Object.keys(toolUsageA.avgCounts));
  const uniqueToolsB = new Set(Object.keys(toolUsageB.avgCounts));
  
  // Tools exclusive to each configuration
  const exclusiveToA = [...uniqueToolsA].filter(tool => !uniqueToolsB.has(tool));
  const exclusiveToB = [...uniqueToolsB].filter(tool => !uniqueToolsA.has(tool));
  
  if (exclusiveToA.length > 0) {
    section += `- Tools used exclusively by **${data.configA.name}**: ${exclusiveToA.map(getToolFriendlyName).join(', ')}\n`;
  }
  
  if (exclusiveToB.length > 0) {
    section += `- Tools used exclusively by **${data.configB.name}**: ${exclusiveToB.map(getToolFriendlyName).join(', ')}\n`;
  }
  
  // Compare total tool usage
  const totalDiff = toolUsageB.avgTotal - toolUsageA.avgTotal;
  if (Math.abs(totalDiff) > 0.5) {
    const moreTools = totalDiff > 0 ? data.configB.name : data.configA.name;
    const lessTools = totalDiff > 0 ? data.configA.name : data.configB.name;
    section += `- **${moreTools}** used more tools on average (${Math.abs(totalDiff).toFixed(1)} more per run) than **${lessTools}**\n`;
  }
  
  return section;
}

/**
 * Get a more readable name for a tool ID
 * 
 * @param toolId The tool ID to format
 * @returns A friendly name for the tool
 */
function getToolFriendlyName(toolId: string): string {
  // Remove common prefixes/suffixes and capitalize
  const name = toolId
    .replace(/Tool$/, '')
    .replace(/^tool/i, '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ');
  
  // Capitalize first letter of each word
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}


/**
 * Format configuration details for the report
 */
function formatConfigDetails(config: { metadata?: Record<string, string | number | boolean | null | undefined>; [key: string]: unknown }): string {
  let details = '';
  
  // Add configuration parameters
  if (config.metadata) {
    details += `**Description:** ${config.metadata.description || 'N/A'}\n\n`;
  }
  
  details += `**Model:** ${typeof config.id === 'string' && config.id.includes('model-') ? config.id.replace('model-', '') : config.id}\n\n`;
  
  if (config.averageMetrics) {
    const metrics = config.averageMetrics as {
      success: number;
      duration: number;
      toolCalls: number;
      tokenUsage: { total: number } | number;
    };
    
    details += `**Metrics Summary:**\n`;
    details += `- Success Rate: ${(metrics.success * 100).toFixed(1)}%\n`;
    details += `- Average Duration: ${metrics.duration.toFixed(2)}s\n`;
    details += `- Average Tool Calls: ${metrics.toolCalls.toFixed(1)}\n`;
    details += `- Average Token Usage: ${typeof metrics.tokenUsage === 'number' ? 
      metrics.tokenUsage.toFixed(0) : 
      (metrics.tokenUsage as { total: number }).total.toFixed(0)}\n`;
  }
  
  return details;
}

/**
 * Calculate average scores across judgment results
 */
function calculateAverageScores(runs: ABTestRunWithHistory[]): Record<string, number> {
  if (runs.length === 0) return {};
  
  const dimensions = new Set<string>();
  const scores: Record<string, number[]> = {};
  
  // Collect all scores
  for (const run of runs) {
    if (run.judgment && run.judgment.scores) {
      Object.entries(run.judgment.scores).forEach(([dimension, score]) => {
        dimensions.add(dimension);
        
        if (!scores[dimension]) {
          scores[dimension] = [];
        }
        
        if (typeof score === 'number') {
          scores[dimension].push(score);
        }
      });
    }
  }
  
  // Calculate averages
  const result: Record<string, number> = {};
  for (const dimension of dimensions) {
    const dimensionScores = scores[dimension] || [];
    if (dimensionScores.length > 0) {
      result[dimension] = dimensionScores.reduce((sum, score) => sum + score, 0) / dimensionScores.length;
    }
  }
  
  return result;
}

/**
 * Get common items from judgment results (original method - uses frequency counting)
 */
function getCommonItems(runs: ABTestRunWithHistory[], property: 'strengths' | 'weaknesses' | 'suggestions'): string[] {
  const items = runs
    .filter(r => r.judgment && r.judgment[property] && Array.isArray(r.judgment[property]))
    .flatMap(r => {
      if (r.judgment && r.judgment[property]) {
        return r.judgment[property] as string[];
      }
      return [];
    });
  
  const counts: Record<string, number> = {};
  items.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });
  
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([item, count]) => `${item} (${count})`);
}


async function summarizeJudgmentProperty(
  runs: ABTestRunWithHistory[], 
  property: 'strengths' | 'weaknesses' | 'suggestions',
  modelProvider: { processQuery: (prompt: string, options: ProcessQueryOptions) => Promise<{ response: string | null }> },
  configName: string
): Promise<string> {
  // Skip if there are no judgments
  const runsWithJudgment = runs.filter(r => r.judgment && r.judgment[property] && Array.isArray(r.judgment[property]));
  if (runsWithJudgment.length === 0) {
    return 'None identified';
  }

  // Extract all items with their execution context
  const allItems: Record<string, string[]> = {};
  runsWithJudgment.forEach((run, index) => {
    if (run.judgment && run.judgment[property]) {
      const items = run.judgment[property] as string[];
      allItems[`Run ${index + 1}`] = items;
    }
  });
  
  // Create a prompt for the LLM to analyze and summarize
  const prompt = `
  I need you to synthesize and summarize the key ${property} identified across multiple judging runs for configuration "${configName}".
  
  Here are the ${property} identified in each run:
  ${Object.entries(allItems).map(([run, items]) => `
  ${run}:
  ${items.map(item => `- ${item}`).join('\n')}
  `).join('\n')}
  
  Please provide a concise, insightful summary of the key ${property} across all runs. 
  Focus on identifying patterns and themes rather than just listing the most common items.
  Look for deeper insights about what makes this configuration perform the way it does.
  
  Your summary should:
  1. Be 2-4 sentences long
  2. Capture the most important patterns
  3. Be specific to this configuration's behavior
  4. Avoid generic observations that could apply to any agent
  5. Focus on what makes this configuration's ${property} distinctive
  
  Only return the summary text without any preamble, explanation, or additional formatting.
  `;
  
  try {
    // Process with the model
    const result = await modelProvider.processQuery(prompt, {
      temperature: 0.3,
      maxTokens: 300
    });
    
    if (result.response) {
      return result.response.trim();
    }
  } catch (error) {
    console.error(`Error summarizing ${property}`, error);
  }
  
  // Fallback to the original method if summarization fails
  return getCommonItems(runs, property).join(', ') || 'None identified';
}