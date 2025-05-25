/**
 * ThinkTool - Provides a dedicated space for Claude to think through complex problems
 */

import { createTool } from './createTool.js';
import { Tool, ToolContext, ValidationResult } from '../types/tool.js';
import { ToolResult } from '../types/tool-result.js';

// Define types for the think tool
interface ThinkArgs {
  thought: string;
}

export type ThinkResult = ToolResult<{ thought: string }>;

/**
 * Creates a think tool that allows Claude to reason through complex problems
 * @returns The think tool interface
 */
export const createThinkTool = (): Tool<ThinkResult> => {
  return createTool({
    id: 'think',
    name: 'ThinkTool',
    description: 'Use the tool to think about something. It will not obtain new information or make any changes to the repository, but just log the thought. Use it when complex reasoning or brainstorming is needed. For example, if you explore the repo and discover the source of a bug, call this tool to brainstorm several unique ways of fixing the bug, and assess which change(s) are likely to be simplest and most effective. Alternatively, if you receive some test results, call this tool to brainstorm ways to fix the failing tests.\n\nExample call:\n            { "thought": "I need to analyze the test failures and consider three approaches: refactoring the validation logic, updating the test data, or changing the API contract." }',
    requiresPermission: false, // Core capability
    
    // Add schema information
    parameters: {
      thought: {
        type: "string",
        description: "Your thoughts."
      }
    },
    requiredParameters: ["thought"],
    
    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (typeof args.thought !== 'string' || args.thought.trim().length === 0) {
        return {
          valid: false,
          reason: "The 'thought' parameter is required and must be a non-empty string"
        };
      }
      
      return { valid: true };
    },
    
    execute: async (args: Record<string, unknown>, _context: ToolContext): Promise<ThinkResult> => {
      if (typeof args.thought !== 'string') {
        return {
          ok: false,
          error: "The 'thought' parameter is required and must be a string"
        };
      }
      
      const typedArgs = args as unknown as ThinkArgs;
      const { thought } = typedArgs;
      
      // Simply return the thought - this tool is just for structured thinking
      return {
        ok: true,
        data: { thought }
      };
    }
  });
};