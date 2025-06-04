/**
 * FileEditTool - Modifies the contents of existing files
 */

import path from 'path';

import type { ToolResult } from '../types/tool-result.js';
import type { Tool, ToolContext, ValidationResult } from '../types/tool.js';
import { ToolCategory } from '../types/tool.js';

import { createTool } from './createTool.js';

// Logger imports removed as they are unused

// Interface for the arguments accepted by the FileEditTool
// Used for type checking and documentation
export interface FileEditToolArgs {
  path: string;
  searchCode: string;
  replaceCode: string;
  encoding?: string;
}

interface FileEditToolData {
  path: string;
  displayPath?: string; // Optional formatted path for UI display
  originalContent: string;
  newContent: string;
}

export type FileEditToolResult = ToolResult<FileEditToolData>;

/**
 * Creates a tool for editing file contents
 * @returns The file edit tool interface
 */
export const createFileEditTool = (): Tool<FileEditToolResult> => {
  return createTool({
    id: 'file_edit',
    name: 'FileEditTool',
    description:
      '- Modifies existing files by replacing specific content\n- Ensures precise targeting of text to be replaced\n- Preserves file structure and formatting\n- Maintains file encodings during edits\n- Normalizes line endings for consistent handling\n- Use this tool for targeted edits to existing files\n- For creating new files, use FileWriteTool instead\n\nUsage notes:\n- First use FileReadTool to understand the file\'s contents\n- The searchCode MUST match exactly once in the file\n- IMPORTANT: Include sufficient context in searchCode to ensure uniqueness\n- Make sure replaceCode maintains correct syntax and indentation\n- Use empty string ("") for replaceCode to delete the matched content\n- For multiple edits, use BatchTool to combine multiple FileEditTool calls\n- WARNING: The edit will fail if searchCode is found multiple times\n- WARNING: The edit will fail if searchCode isn\'t found exactly as provided\n- TIP: For complex edits, consider using FileWriteTool instead\n- TIP: When possible, include a few lines before and after the code you want to replace\n\nExample calls:\n            { "path": "src/utils.js", "searchCode": "function oldName() {\\n  return true;\\n}", "replaceCode": "function newName() {\\n  return true;\\n}" }\n            { "path": "src/utils.js", "searchCode": "// TODO: remove this\\nconsole.log(\\"debug\\");", "replaceCode": "" }',
    requiresPermission: true,
    category: ToolCategory.FILE_OPERATION,
    alwaysRequirePermission: false, // Can be bypassed in fast edit mode

    // Enhanced parameter descriptions
    parameters: {
      path: {
        type: 'string',
        description:
          "Path to the file to edit. Can be relative like 'src/index.js', '../README.md' or absolute",
      },
      searchCode: {
        type: 'string',
        description:
          'The code snippet to search for in the file (must match exactly once). Include sufficient surrounding context to ensure a unique match.',
      },
      replaceCode: {
        type: 'string',
        description:
          'The new code to replace the matched code with. Maintain proper indentation and formatting.',
      },
      encoding: {
        type: 'string',
        description: "File encoding to use. Default: 'utf8'",
      },
    },
    requiredParameters: ['path', 'searchCode', 'replaceCode'],

    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (!args.path || typeof args.path !== 'string') {
        return {
          valid: false,
          reason: 'File path must be provided as a non-empty string',
        };
      }

      if (!args.searchCode || typeof args.searchCode !== 'string') {
        return {
          valid: false,
          reason:
            'Search code must be provided as a non-empty string. Include sufficient context to ensure a unique match.',
        };
      }

      if (typeof args.replaceCode !== 'string') {
        return {
          valid: false,
          reason:
            'Replace code must be provided as a string. Use an empty string ("") to delete the matched code.',
        };
      }

      return { valid: true };
    },

    execute: async (
      args: Record<string, unknown>,
      context: ToolContext,
    ): Promise<FileEditToolResult> => {
      // Extract and type-cast each argument individually
      const filePath = args.path as string;
      const searchCode = args.searchCode as string;
      const replaceCode = args.replaceCode as string;
      const encoding = (args.encoding as string) || 'utf8';

      // Check if the file has been read first
      if (context.sessionState && !context.sessionState.contextWindow.hasReadFile(filePath)) {
        context.logger?.warn(`Attempt to edit file ${filePath} without reading it first`);
        return {
          ok: false,
          error: `File must be read before editing. Please use FileReadTool first to read ${filePath} and understand its contents before making changes.`,
        };
      }

      // Check if we're running in a sandbox (E2B)
      const isSandbox = !!process.env.SANDBOX_ROOT;

      if (isSandbox && path.isAbsolute(filePath)) {
        // In sandbox mode, log warnings about absolute paths that don't match expected pattern
        const sandboxRoot = process.env.SANDBOX_ROOT || '/home/user/app';

        // If the path doesn't start with sandbox root, log a warning
        if (!filePath.startsWith(sandboxRoot)) {
          context.logger?.warn(
            `Warning: FileEditTool: Using absolute path outside sandbox: ${filePath}. This may fail.`,
          );
        }

        // Keep the original path
      }

      const executionAdapter = context.executionAdapter;

      console.info(`Editing file: ${filePath}`);
      try {
        return await executionAdapter.editFile(
          context.executionId,
          filePath,
          searchCode,
          replaceCode,
          encoding,
        );
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`Error editing file: ${err.message}`);
        return {
          ok: false,
          error: `Failed to edit file ${filePath}: ${err.message}`,
        };
      }
    },
  });
};
