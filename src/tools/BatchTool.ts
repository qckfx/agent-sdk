/**
 * BatchTool - Batch execution of multiple tool calls in a single request
 */

import type { ToolResult } from '../types/tool-result.js';
import type { Tool, ToolContext, ValidationResult } from '../types/tool.js';
import { ToolCategory } from '../types/tool.js';

import { createTool } from './createTool.js';

// Used for type checking in execute function
export interface BatchToolArgs {
  description: string;
  invocations: BatchToolInvocation[];
}

export interface BatchToolInvocation {
  tool_name: string;
  input: Record<string, unknown>;
}

interface BatchToolItemResult {
  tool_name: string;
  success: boolean;
  result?: unknown;
  error?: string;
  execution_time_ms?: number;
}

interface BatchToolData {
  description: string;
  results: BatchToolItemResult[];
}

export type BatchToolResult = ToolResult<BatchToolData>;

/**
 * Creates a tool for batch execution of multiple tool invocations
 * @returns The batch tool interface
 */
export const createBatchTool = (): Tool<BatchToolResult> => {
  return createTool({
    id: 'batch',
    name: 'BatchTool',
    description:
      '- Batch execution tool that runs multiple tool invocations in a single request\n- Tools are executed in parallel when possible, and otherwise serially\n- Takes a list of tool invocations (tool_name and input pairs)\n- Returns the collected results from all invocations\n- Use this tool when you need to run multiple independent tool operations at once -- it is awesome for speeding up your workflow, reducing both context usage and latency\n- Each tool will respect its own permissions and validation rules\n- The tool\'s outputs are NOT shown to the user; to answer the user\'s query, you MUST send a message with the results after the tool call completes, otherwise the user will not see the results\n\nExample call:\n            { "description": "Read multiple files", "invocations": [{ "tool_name": "FileReadTool", "input": { "path": "src/index.js" } }, { "tool_name": "FileReadTool", "input": { "path": "src/utils.js" } }] }',
    requiresPermission: true, // Since it can execute multiple tools, permissions should be checked
    category: [
      ToolCategory.READONLY,
      ToolCategory.FILE_OPERATION,
      ToolCategory.SHELL_EXECUTION,
      ToolCategory.NETWORK,
    ],
    alwaysRequirePermission: true, // Always require permission since it can run any tool

    parameters: {
      description: {
        type: 'string',
        description: 'A short (3-5 word) description of the batch operation',
      },
      invocations: {
        type: 'array',
        description: 'The list of tool invocations to execute',
        items: {
          type: 'object',
          properties: {
            tool_name: {
              type: 'string',
              description: 'The name of the tool to invoke',
            },
            input: {
              type: 'object',
              description: 'The input to pass to the tool',
            },
          },
          required: ['tool_name', 'input'],
        },
      },
    },
    requiredParameters: ['description', 'invocations'],

    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (!args.description || typeof args.description !== 'string') {
        return {
          valid: false,
          reason: 'Description must be a string',
        };
      }

      if (!args.invocations || !Array.isArray(args.invocations)) {
        return {
          valid: false,
          reason: 'Invocations must be an array',
        };
      }

      // Validate each invocation
      const invocations = args.invocations as BatchToolInvocation[];

      if (invocations.length === 0) {
        return {
          valid: false,
          reason: 'At least one invocation is required',
        };
      }

      for (let i = 0; i < invocations.length; i++) {
        const invocation = invocations[i];

        if (!invocation.tool_name || typeof invocation.tool_name !== 'string') {
          return {
            valid: false,
            reason: `Invocation ${i}: tool_name must be a string`,
          };
        }

        if (
          !invocation.input ||
          typeof invocation.input !== 'object' ||
          Array.isArray(invocation.input)
        ) {
          return {
            valid: false,
            reason: `Invocation ${i}: input must be an object`,
          };
        }
      }

      return { valid: true };
    },

    execute: async (
      args: Record<string, unknown>,
      context: ToolContext,
    ): Promise<BatchToolResult> => {
      const description = args.description as string;
      const invocations = args.invocations as BatchToolInvocation[];
      const results: BatchToolItemResult[] = [];

      try {
        // Create a map to get tools by name (instead of by ID)
        const toolRegistry = context.toolRegistry;

        if (!toolRegistry) {
          throw new Error('Tool registry is not available in the execution context');
        }

        const allTools = toolRegistry.getAllTools();
        const toolsByName = new Map<string, Tool>();

        allTools.forEach(tool => {
          toolsByName.set(tool.name, tool);
        });

        // Execute all tool invocations (potentially in parallel using Promise.all)
        const executionPromises = invocations.map(async (invocation, index) => {
          const { tool_name, input } = invocation;
          const startTime = Date.now();

          try {
            // Find the tool by name
            const tool = toolsByName.get(tool_name);

            if (!tool) {
              // If tool not found by name, try by ID as fallback
              const toolById = toolRegistry.getTool(tool_name);

              if (!toolById) {
                return {
                  tool_name,
                  success: false,
                  error: `Tool ${tool_name} not found`,
                };
              }

              // Use the tool found by ID
              const result = await toolById.execute(input, context);
              const executionTime = Date.now() - startTime;

              return {
                tool_name,
                success: true,
                result,
                execution_time_ms: executionTime,
              };
            }

            // Execute the tool
            const result = await tool.execute(input, context);
            const executionTime = Date.now() - startTime;

            return {
              tool_name,
              success: true,
              result,
              execution_time_ms: executionTime,
            };
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            return {
              tool_name,
              success: false,
              error: err.message,
            };
          }
        });

        // Wait for all executions to complete
        const executionResults = await Promise.all(executionPromises);
        results.push(...executionResults);

        // The BatchTool itself always succeeds if it processed all subtool invocations
        // Even if some subtools failed, this is considered a successful batch operation
        return {
          ok: true,
          data: {
            description,
            results,
          },
        };
      } catch (error) {
        // This should only happen if there's an error in the BatchTool itself,
        // not in the subtool executions
        const err = error instanceof Error ? error : new Error(String(error));

        return {
          ok: false,
          error: `Error in BatchTool execution: ${err.message}`,
        };
      }
    },
  });
};
