/**
 * Utilities for analyzing tool usage in evaluation runs
 */

import { AgentExecutionHistory } from '../models/types.js';
import { ABTestRunWithHistory } from '../models/ab-types.js';
import { getToolFriendlyName } from './tools.js';

/**
 * Tool usage statistics for a single run
 */
export interface ToolUsageStats {
  // Total number of times each tool was used
  counts: Record<string, number>;

  // Percentage of total tool usage for each tool
  percentages: Record<string, number>;

  // Total tool uses
  total: number;

  // Number of unique tools used
  uniqueTools: number;

  // Usage sequence (order of tool usage)
  sequence: string[];
}

/**
 * Aggregate tool usage statistics across multiple runs
 */
export interface AggregateToolUsage {
  // Average uses per tool
  avgCounts: Record<string, number>;

  // Average percentage of total tool usage
  avgPercentages: Record<string, number>;

  // Average total tools used per run
  avgTotal: number;

  // Average number of unique tools used per run
  avgUniqueTools: number;

  // Most common first tool
  mostCommonFirstTool?: string;

  // Most common tool sequences (patterns of 2-3 consecutive tools)
  commonSequences: Array<{
    sequence: string[];
    count: number;
    percentage: number;
  }>;
}

/**
 * Analyze tool usage for a single execution history
 * @param executionHistory Agent execution history
 * @returns Tool usage statistics
 */
export function analyzeExecutionToolUsage(executionHistory: AgentExecutionHistory): ToolUsageStats {
  const counts: Record<string, number> = {};
  const sequence: string[] = [];

  // Extract all tool uses from the execution history
  for (const toolCall of executionHistory.toolCalls || []) {
    const toolId = toolCall.tool;
    counts[toolId] = (counts[toolId] || 0) + 1;
    sequence.push(toolId);
  }

  // Calculate total tool uses and unique tools
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const uniqueTools = Object.keys(counts).length;

  // Calculate percentages
  const percentages: Record<string, number> = {};
  for (const [toolId, count] of Object.entries(counts)) {
    percentages[toolId] = total > 0 ? (count / total) * 100 : 0;
  }

  return {
    counts,
    percentages,
    total,
    uniqueTools,
    sequence,
  };
}

/**
 * Find common tool usage patterns (2-3 consecutive tools)
 * @param sequences Array of tool usage sequences
 * @param patternLength Length of patterns to look for (2 or 3)
 * @param minCount Minimum count to include in results
 * @returns Array of common patterns with their counts
 */
function findCommonPatterns(
  sequences: string[][],
  patternLength: number,
  minCount: number = 2,
): Array<{
  sequence: string[];
  count: number;
  percentage: number;
}> {
  // Count pattern occurrences
  const patternCounts: Record<string, number> = {};
  let totalPatterns = 0;

  for (const sequence of sequences) {
    if (sequence.length < patternLength) continue;

    for (let i = 0; i <= sequence.length - patternLength; i++) {
      const pattern = sequence.slice(i, i + patternLength);
      const patternKey = pattern.join(',');
      patternCounts[patternKey] = (patternCounts[patternKey] || 0) + 1;
      totalPatterns++;
    }
  }

  // Convert to array and sort
  return Object.entries(patternCounts)
    .filter(([_, count]) => count >= minCount)
    .map(([patternKey, count]) => ({
      sequence: patternKey.split(','),
      count,
      percentage: totalPatterns > 0 ? (count / totalPatterns) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Analyze tool usage across multiple test runs
 * @param runs Array of test runs with execution histories
 * @returns Aggregate tool usage statistics
 */
export function analyzeAggregateToolUsage(runs: ABTestRunWithHistory[]): AggregateToolUsage {
  // Skip if no runs
  if (!runs || runs.length === 0) {
    return {
      avgCounts: {},
      avgPercentages: {},
      avgTotal: 0,
      avgUniqueTools: 0,
      commonSequences: [],
    };
  }

  // Analyze each run
  const allStats = runs.map(run => analyzeExecutionToolUsage(run.executionHistory));

  // Collect all tool sequences
  const allSequences = allStats.map(stats => stats.sequence);

  // Count first tools
  const firstToolCounts: Record<string, number> = {};
  for (const stats of allStats) {
    if (stats.sequence.length > 0) {
      const firstTool = stats.sequence[0];
      firstToolCounts[firstTool] = (firstToolCounts[firstTool] || 0) + 1;
    }
  }

  // Find most common first tool
  let mostCommonFirstTool: string | undefined;
  let maxFirstToolCount = 0;

  for (const [tool, count] of Object.entries(firstToolCounts)) {
    if (count > maxFirstToolCount) {
      mostCommonFirstTool = tool;
      maxFirstToolCount = count;
    }
  }

  // Collect all tool counts
  const allToolIds = new Set<string>();
  for (const stats of allStats) {
    for (const toolId in stats.counts) {
      allToolIds.add(toolId);
    }
  }

  // Calculate averages
  const avgCounts: Record<string, number> = {};
  const avgPercentages: Record<string, number> = {};

  for (const toolId of allToolIds) {
    const sum = allStats.reduce((total, stats) => total + (stats.counts[toolId] || 0), 0);
    avgCounts[toolId] = sum / runs.length;

    const percentSum = allStats.reduce(
      (total, stats) => total + (stats.percentages[toolId] || 0),
      0,
    );
    avgPercentages[toolId] = percentSum / runs.length;
  }

  // Calculate other averages
  const avgTotal = allStats.reduce((sum, stats) => sum + stats.total, 0) / runs.length;
  const avgUniqueTools = allStats.reduce((sum, stats) => sum + stats.uniqueTools, 0) / runs.length;

  // Find common patterns (both 2 and 3 tool sequences)
  const commonPairs = findCommonPatterns(allSequences, 2);
  const commonTriplets = findCommonPatterns(allSequences, 3);

  // Combine and sort by count
  const commonSequences = [...commonPairs, ...commonTriplets]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Keep only top 10

  return {
    avgCounts,
    avgPercentages,
    avgTotal,
    avgUniqueTools,
    mostCommonFirstTool,
    commonSequences,
  };
}

/**
 * Generate a markdown table comparing tool usage between configurations
 * @param toolUsageA Aggregate tool usage for Configuration A
 * @param toolUsageB Aggregate tool usage for Configuration B
 * @param configAName Name of Configuration A
 * @param configBName Name of Configuration B
 * @returns Markdown table as string
 */
export function generateToolUsageComparisonTable(
  toolUsageA: AggregateToolUsage,
  toolUsageB: AggregateToolUsage,
  configAName: string,
  configBName: string,
): string {
  // Combine all tool IDs
  const allTools = new Set([
    ...Object.keys(toolUsageA.avgCounts),
    ...Object.keys(toolUsageB.avgCounts),
  ]);

  let table = `| Tool | ${configAName} (avg/run) | ${configBName} (avg/run) | Difference | % of total (${configAName}) | % of total (${configBName}) |\n`;
  table += `| ---- | -------- | -------- | ---------- | ------- | ------- |\n`;

  // Add rows for each tool
  for (const tool of Array.from(allTools).sort()) {
    const usageA = toolUsageA.avgCounts[tool] || 0;
    const usageB = toolUsageB.avgCounts[tool] || 0;
    const rawDiff = usageB - usageA;
    const diff = rawDiff.toFixed(2);

    // Calculate percentage change, handling division by zero
    let percentChange = '';
    if (usageA > 0) {
      const percent = (rawDiff / usageA) * 100;
      percentChange = ` (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%)`;
    }

    const percentA = toolUsageA.avgPercentages[tool] || 0;
    const percentB = toolUsageB.avgPercentages[tool] || 0;

    table += `| ${getToolFriendlyName(tool)} | ${usageA.toFixed(2)} | ${usageB.toFixed(2)} | ${diff}${percentChange} | ${percentA.toFixed(1)}% | ${percentB.toFixed(1)}% |\n`;
  }

  return table;
}

/**
 * Generate a markdown section with tool usage patterns
 * @param toolUsageA Aggregate tool usage for Configuration A
 * @param toolUsageB Aggregate tool usage for Configuration B
 * @param configAName Name of Configuration A
 * @param configBName Name of Configuration B
 * @returns Markdown section as string
 */
export function generateToolPatternsSection(
  toolUsageA: AggregateToolUsage,
  toolUsageB: AggregateToolUsage,
  configAName: string,
  configBName: string,
): string {
  let section = `### Tool Usage Patterns\n\n`;

  // Summary statistics
  section += `#### Summary Statistics\n\n`;
  section += `| Metric | ${configAName} | ${configBName} | Difference |\n`;
  section += `| ------ | -------- | -------- | ---------- |\n`;
  section += `| Avg. tools per run | ${toolUsageA.avgTotal.toFixed(2)} | ${toolUsageB.avgTotal.toFixed(2)} | ${(toolUsageB.avgTotal - toolUsageA.avgTotal).toFixed(2)} |\n`;
  section += `| Avg. unique tools per run | ${toolUsageA.avgUniqueTools.toFixed(2)} | ${toolUsageB.avgUniqueTools.toFixed(2)} | ${(toolUsageB.avgUniqueTools - toolUsageA.avgUniqueTools).toFixed(2)} |\n`;
  section += `| Most common first tool | ${toolUsageA.mostCommonFirstTool ? getToolFriendlyName(toolUsageA.mostCommonFirstTool) : 'N/A'} | ${toolUsageB.mostCommonFirstTool ? getToolFriendlyName(toolUsageB.mostCommonFirstTool) : 'N/A'} | - |\n`;

  // Common tool sequences
  if (toolUsageA.commonSequences.length > 0 || toolUsageB.commonSequences.length > 0) {
    section += `\n#### Common Tool Sequences\n\n`;

    if (toolUsageA.commonSequences.length > 0) {
      section += `**${configAName} Common Sequences:**\n\n`;
      for (const pattern of toolUsageA.commonSequences.slice(0, 5)) {
        const toolNames = pattern.sequence.map(getToolFriendlyName);
        section += `- ${toolNames.join(' → ')} (${pattern.count} occurrences, ${pattern.percentage.toFixed(1)}%)\n`;
      }
      section += `\n`;
    }

    if (toolUsageB.commonSequences.length > 0) {
      section += `**${configBName} Common Sequences:**\n\n`;
      for (const pattern of toolUsageB.commonSequences.slice(0, 5)) {
        const toolNames = pattern.sequence.map(getToolFriendlyName);
        section += `- ${toolNames.join(' → ')} (${pattern.count} occurrences, ${pattern.percentage.toFixed(1)}%)\n`;
      }
    }
  }

  return section;
}
