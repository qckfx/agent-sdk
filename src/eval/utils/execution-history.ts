/**
 * Utilities for extracting and formatting agent execution history
 */

import { ToolCallRecord, AgentExecutionHistory, ExecutionMetadata } from '../models/types.js';
import { ProcessQueryResult } from '../../types/agent.js';

/**
 * Extract execution history from ProcessQueryResult
 */
export function extractExecutionHistory(
  result: ProcessQueryResult,
  taskDescription?: string,
  options?: {
    runInfo?: {
      runId?: string;
      testId?: string;
      testName?: string;
    };
    configInfo?: {
      configId?: string;
      configName?: string;
      modelName?: string;
      promptName?: string;
    };
  },
): AgentExecutionHistory {
  // Extract tool calls from the result
  const toolCalls: ToolCallRecord[] = [];

  if (result.result?.toolResults) {
    for (const toolResult of result.result.toolResults) {
      toolCalls.push({
        tool: toolResult.toolId,
        args: toolResult.args,
        result: String(toolResult.result || ''),
        startTime: '', // These fields aren't available in the current structure
        endTime: '', // but are part of our schema for future use
      });
    }
  }

  // Create metadata if task description is provided
  let metadata: ExecutionMetadata | undefined;
  if (taskDescription) {
    metadata = {
      task: taskDescription,
      runInfo: options?.runInfo,
      configInfo: options?.configInfo,
    };
  }

  return {
    metadata,
    toolCalls,
    response: result.response, // Include the agent's final response
  };
}

/**
 * Format arguments for display
 */
export function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => {
      // Handle different value types
      if (typeof value === 'string') {
        // Truncate long string values
        const displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
        return `${key}: "${displayValue}"`;
      } else if (Array.isArray(value)) {
        return `${key}: [Array with ${value.length} items]`;
      } else if (typeof value === 'object' && value !== null) {
        return `${key}: {Object}`;
      }
      return `${key}: ${value}`;
    })
    .join(', ');
}

/**
 * Format the execution history for the judge prompt
 */
export function formatExecutionHistoryForJudge(history: AgentExecutionHistory): string {
  let formattedHistory = '';

  // Add task description if available
  if (history.metadata?.task) {
    formattedHistory += `### Task\n${history.metadata.task}\n\n`;
  }

  // Add run info if available
  if (history.metadata?.runInfo) {
    const runInfo = history.metadata.runInfo;
    formattedHistory += `### Run Information\n`;
    if (runInfo.runId) formattedHistory += `Run ID: ${runInfo.runId}\n`;
    if (runInfo.testId) formattedHistory += `Test ID: ${runInfo.testId}\n`;
    if (runInfo.testName) formattedHistory += `Test Name: ${runInfo.testName}\n`;
    formattedHistory += `\n`;
  }

  // Add configuration info if available
  if (history.metadata?.configInfo) {
    const configInfo = history.metadata.configInfo;
    formattedHistory += `### Configuration\n`;
    if (configInfo.configId) formattedHistory += `Config ID: ${configInfo.configId}\n`;
    if (configInfo.configName) formattedHistory += `Config Name: ${configInfo.configName}\n`;
    if (configInfo.modelName) formattedHistory += `Model: ${configInfo.modelName}\n`;
    if (configInfo.promptName) formattedHistory += `Prompt: ${configInfo.promptName}\n`;
    formattedHistory += `\n`;
  }

  // Add the agent's final response first if available (to emphasize its importance)
  if (history.response) {
    formattedHistory += `### Agent Final Response (PRIMARY OUTPUT TO EVALUATE)\n${history.response}\n\n`;
  }

  // Add tool call sequence heading
  formattedHistory += `### Tool Call Sequence (Agent's Thinking Process)\n`;

  if (history.toolCalls.length === 0) {
    formattedHistory += 'No tool calls were made during execution.\n\n';
  } else {
    // Format each tool call
    history.toolCalls.forEach((tc, index) => {
      formattedHistory += `\n#### Tool Call ${index + 1}: ${tc.tool}\n`;
      formattedHistory += `**Arguments:** ${formatArgs(tc.args)}\n`;
      formattedHistory += `**Result:** ${formatToolResult(tc.result)}\n`;

      // Add timing information if available
      if (tc.startTime && tc.endTime) {
        formattedHistory += `**Execution Time:** ${formatTimeDifference(tc.startTime, tc.endTime)}\n`;
      }

      // Add special highlight for code writing tools
      if (
        tc.tool === 'Edit' ||
        tc.tool === 'Replace' ||
        tc.tool === 'FileEditTool' ||
        tc.tool === 'FileWriteTool'
      ) {
        formattedHistory += `**NOTE: This is a CODE WRITING action (important for evaluation)**\n`;
      }
    });
  }

  return formattedHistory;
}

/**
 * Format a tool result for display
 */
function formatToolResult(result: string): string {
  // Truncate very long results
  if (result.length > 500) {
    return result.substring(0, 500) + '... [truncated]';
  }
  return result;
}

/**
 * Calculate and format the time difference between two ISO timestamps
 */
function formatTimeDifference(startTime: string, endTime: string): string {
  try {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const diffMs = end - start;

    if (diffMs < 1000) {
      return `${diffMs}ms`;
    } else {
      return `${(diffMs / 1000).toFixed(2)}s`;
    }
  } catch {
    return 'Unknown';
  }
}
