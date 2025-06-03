/**
 * FileReadTool - Reads the contents of files
 */

import path from 'path';
import { createTool } from './createTool.js';
import { Tool, ToolContext, ValidationResult, ToolCategory } from '../types/tool.js';
import { ToolResult } from '../types/tool-result.js';

// Interface for the arguments accepted by the FileReadTool
// Used for type checking and documentation
export interface FileReadToolArgs {
  path: string;
  encoding?: string;
  maxSize?: number;
  lineOffset?: number;
  lineCount?: number;
}

interface FileReadToolData {
  path: string;
  displayPath?: string; // Optional formatted path for UI display
  content: string;
  size: number;
  encoding: string;
  pagination?: {
    totalLines: number;
    startLine: number;
    endLine: number;
    hasMore: boolean;
  };
}

export type FileReadToolResult = ToolResult<FileReadToolData>;

/**
 * Creates a tool for reading file contents
 * @returns The file read tool interface
 */
export const createFileReadTool = (): Tool<FileReadToolResult> => {
  return createTool({
    id: 'file_read',
    name: 'FileReadTool',
    description:
      '- Reads the contents of files in the filesystem\n- Handles text files with various encodings\n- Supports partial file reading with line offset and count\n- Limits file size for performance and safety (500KB hard cap)\n- Automatically prefixes each line with its number (like `cat -n`) for easier code review\n- Use this tool to examine file contents\n- Use LSTool to explore directories before reading specific files\n\nUsage notes:\n- Provide the exact file path to read\n- Files larger than 500KB will be rejected, even if a higher `maxSize` is supplied\n- At most 1 000 lines can be returned in a single call, even if a higher `lineCount` is supplied\n- For large files, make multiple calls with `lineOffset` to page through the file\n- The returned text always includes line numbers; there is currently no flag to disable them\n- The result also includes metadata such as file size and encoding\n\nExample call:\n            { "path": "src/index.js", "lineOffset": 10, "lineCount": 50 }',
    requiresPermission: false, // Reading files is generally safe
    category: ToolCategory.READONLY,

    // Enhanced parameter descriptions
    parameters: {
      path: {
        type: 'string',
        description:
          "Path to the file to read. Can be relative like 'src/index.js', '../README.md' or absolute",
      },
      encoding: {
        type: 'string',
        description: "File encoding to use. Default: 'utf8'",
      },
      maxSize: {
        type: 'number',
        description:
          'Maximum file size in bytes to read. Default: 524288 (500KB). Hard-capped at 500KB regardless of value provided.',
      },
      lineOffset: {
        type: 'number',
        description: 'Line number to start reading from (0-based). Default: 0',
      },
      lineCount: {
        type: 'number',
        description:
          'Maximum number of lines to read. Default: 1000 lines. Hard-capped at 1000 regardless of value provided.',
      },
    },
    requiredParameters: ['path'],

    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (!args.path || typeof args.path !== 'string') {
        return {
          valid: false,
          reason: 'File path must be a string',
        };
      }
      return { valid: true };
    },

    execute: async (
      args: Record<string, unknown>,
      context: ToolContext,
    ): Promise<FileReadToolResult> => {
      // Extract and type-cast each argument individually
      const filePath = args.path as string;
      const encoding = (args.encoding as string) || 'utf8';
      // Hard cap the maxSize at 500KB to prevent context overflow
      const requestedMaxSize = (args.maxSize as number) || 524288; // Default to 500KB
      const maxSize = Math.min(requestedMaxSize, 524288); // Hard cap at 500KB
      const lineOffset = (args.lineOffset as number) || 0;
      // Hard cap the lineCount at 1000 to prevent context overflow
      const requestedLineCount =
        args.lineCount !== undefined ? (args.lineCount as number) : undefined;
      const lineCount = requestedLineCount ? Math.min(requestedLineCount, 1000) : 1000;

      // Check if we're running in a sandbox (E2B)
      const isSandbox = !!process.env.SANDBOX_ROOT;

      if (isSandbox && path.isAbsolute(filePath)) {
        // In sandbox mode, log warnings about absolute paths that don't match expected pattern
        const sandboxRoot = process.env.SANDBOX_ROOT || '/home/user/app';

        // If the path doesn't start with sandbox root, log a warning
        if (!filePath.startsWith(sandboxRoot)) {
          context.logger?.warn(
            `Warning: FileReadTool: Using absolute path outside sandbox: ${filePath}. This may fail.`,
          );
        }

        // Keep the original path
      }

      const executionAdapter = context.executionAdapter;

      try {
        const result = await executionAdapter.readFile(
          context.executionId,
          filePath,
          maxSize,
          lineOffset,
          lineCount,
          encoding,
        );

        // If successful (result.ok is true), record the file read in the contextWindow
        if (result.ok === true && context.sessionState && context.sessionState.contextWindow) {
          context.sessionState.contextWindow.recordFileRead(filePath);
        }

        return result;
      } catch (error: unknown) {
        const err = error as Error;
        context.logger?.error(`Error reading file: ${err.message}`);
        return {
          ok: false,
          error: err.message,
        };
      }
    },
  });
};
