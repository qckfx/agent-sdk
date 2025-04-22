/**
 * FileWriteTool - Creates new files
 */

import path from 'path';
import { createTool } from './createTool.js';
import { Tool, ToolContext, ValidationResult, ToolCategory } from '../types/tool.js';

// Removed unused interface
// interface FileWriteToolArgs {
//   path: string;
//   content: string;
//   encoding?: string;
//   overwrite?: boolean;
//   createDir?: boolean;
// }

interface FileWriteToolSuccessResult {
  success: true;
  path: string;
  content: string;
  encoding: string;
}

interface FileWriteToolErrorResult {
  success: false;
  path: string;
  error: string;
}

export type FileWriteToolResult = FileWriteToolSuccessResult | FileWriteToolErrorResult;

/**
 * Creates a tool for writing new files
 * @returns The file write tool interface
 */
export const createFileWriteTool = (): Tool => {
  return createTool({
    id: 'file_write',
    name: 'FileWriteTool',
    description: '- Creates new files with specified content\n- Optionally overwrites existing files\n- Supports various text encodings\n- Can automatically create parent directories\n- Use this tool to create new files or completely replace existing ones\n- For targeted edits to existing files, use FileEditTool instead\n\nUsage notes:\n- Specify whether to overwrite existing files with the overwrite parameter\n- Parent directories can be created automatically with createDir=true\n- IMPORTANT: Double-check the file path before writing\n- WARNING: Setting overwrite=true will completely replace any existing file\n- Files are written with the specified encoding',
    requiresPermission: true,
    category: ToolCategory.FILE_OPERATION,
    alwaysRequirePermission: false, // Can be bypassed in fast edit mode
    
    // Enhanced parameter descriptions
    parameters: {
      path: {
        type: "string",
        description: "Path where the file should be created. Can be relative like 'src/newfile.js', '../data.json' or absolute"
      },
      content: {
        type: "string",
        description: "Content to write to the file"
      },
      encoding: {
        type: "string",
        description: "File encoding to use. Default: 'utf8'"
      },
      overwrite: {
        type: "boolean",
        description: "Whether to overwrite the file if it already exists. Default: false"
      },
      createDir: {
        type: "boolean",
        description: "Whether to create parent directories if they don't exist. Default: true"
      }
    },
    requiredParameters: ["path", "content"],
    
    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (!args.path || typeof args.path !== 'string') {
        return { 
          valid: false, 
          reason: 'File path must be a string' 
        };
      }
      
      if (args.content === undefined) {
        return {
          valid: false,
          reason: 'File content must be provided'
        };
      }
      
      return { valid: true };
    },
    
    execute: async (args: Record<string, unknown>, context: ToolContext): Promise<FileWriteToolResult> => {
      // Extract and type-cast each argument individually
      const filePath = args.path as string;
      const content = args.content as string;
      const encoding = args.encoding as string || 'utf8';
      const overwrite = args.overwrite as boolean || false;
      const createDir = args.createDir as boolean ?? true;

      // Check if we're using LocalExecutionAdapter
      if (context.executionAdapter.constructor.name === 'LocalExecutionAdapter') {
        context.logger?.error(`Using LocalExecutionAdapter for file write to: ${filePath}`);
      }
      
      try {
        // Check if we're running in a sandbox (E2B)
        const isSandbox = !!process.env.SANDBOX_ROOT;
        
        if (isSandbox && path.isAbsolute(filePath)) {
          // In sandbox mode, log warnings about absolute paths that don't match expected pattern
          const sandboxRoot = process.env.SANDBOX_ROOT || '/home/user/app';
          
          // If the path doesn't start with sandbox root, log a warning
          if (!filePath.startsWith(sandboxRoot)) {
            context.logger?.warn(`Warning: FileWriteTool: Using absolute path outside sandbox: ${filePath}. This may fail.`);
          }
        }
        
        const dirPath = path.dirname(filePath);
        
        // Check if file already exists using the execution adapter
        try {
          const readResult = await context.executionAdapter.readFile(filePath);
          
          if (readResult.success === true) {
            // If overwrite is not enabled, don't allow writing
            if (!overwrite) {
              return {
                success: false,
                path: filePath,
                error: `File already exists: ${filePath}. Set overwrite to true to replace it.`
              };
            }
            
            // If overwrite is enabled, check if the file has been read first
            if (context.sessionState && 
                !context.sessionState.contextWindow.hasReadFile(filePath)) {
              context.logger?.warn(`Attempt to overwrite file ${filePath} without reading it first`);
              return {
                success: false,
                path: filePath,
                error: `File must be read before overwriting. Please use FileReadTool first to read the file.`
              };
            }
          }
        } catch {
          // File doesn't exist, which is what we want for creating a new file
          // Or there was an error that will be handled during write
        }
        
        // Create directory if it doesn't exist
        if (createDir) {
          try {
            // Use bash command through execution adapter to create directory
            await context.executionAdapter.executeCommand(`mkdir -p ${dirPath}`);
          } catch (error: unknown) {
            // If directory creation fails, the writeFile will also fail
            context.logger?.warn(`Failed to create directory: ${dirPath}`, error);
          }
        }
        
        // Write the file using the execution adapter
        context.logger?.debug(`Creating file: ${filePath}`);
        await context.executionAdapter.writeFile(filePath, content);
        
        return {
          success: true,
          path: filePath,
          content,
          encoding
        };
      } catch (error: unknown) {
        const err = error as Error;
        context.logger?.error(`Error writing file: ${err.message}`);
        return {
          success: false,
          path: filePath,
          error: err.message
        };
      }
    }
  });
};