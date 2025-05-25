/**
 * LSTool - Lists directory contents
 */

import path from 'path';
import { createTool } from './createTool.js';
import { Tool, ToolContext, ValidationResult, ToolCategory } from '../types/tool.js';
import { ToolResult } from '../types/tool-result.js';


interface LSToolArgs {
  path?: string;
  showHidden?: boolean;
  details?: boolean;
  limit?: number; // New parameter to limit the number of entries returned
}

export interface FileEntry {
  name: string;
  type?: string;
  size?: number;
  modified?: Date;
  created?: Date;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  error?: string;
}

interface LSToolData {
  path: string;
  entries: FileEntry[];
  count: number;
  totalCount?: number; // New field to indicate total count when limited
}

export type LSToolResult = ToolResult<LSToolData>;

// Cache for directory listings to improve performance
const directoryCache = new Map<string, {
  entries: FileEntry[];
  timestamp: number;
  showHidden: boolean;
  details: boolean;
}>();

// Cache expiration time (5 seconds)
const CACHE_EXPIRATION = 5000;

/**
 * Creates a tool for listing directory contents
 * @returns The LS tool interface
 */
export const createLSTool = (): Tool<LSToolResult> => {
  return createTool({
    id: 'ls',
    name: 'LSTool',
    description: '- Lists files and directories in a given path\n- Provides directory exploration capabilities\n- Offers options for showing hidden files\n- Can display detailed file information\n- Use this tool to explore directory contents before working with files\n- For finding specific files by pattern, use GlobTool instead\n\nUsage notes:\n- Returns all files and directories in the specified path\n- Set showHidden=true to include files starting with \'.\'\n- Set details=true to get additional file information (size, dates)\n- Set limit=N to limit the number of entries returned (default: 100)\n- Results are not recursive - only shows direct children of the path\n- Use this before reading or writing files to confirm locations\n- For more targeted file finding, use GlobTool after exploring\n\nExample call:\n            { "path": "src", "showHidden": false, "details": true, "limit": 50 }',
    requiresPermission: false, // Listing directories is generally safe
    category: ToolCategory.READONLY,
    
    // Add detailed parameter descriptions
    parameters: {
      path: {
        type: "string",
        description: "The directory to list contents from. Use relative paths like 'src', '../', 'docs/v2' or absolute paths. Default: current directory ('.')"
      },
      showHidden: {
        type: "boolean",
        description: "Whether to show hidden files (starting with '.'). Default: false"
      },
      details: {
        type: "boolean",
        description: "Whether to show detailed file information (size, dates, etc). Default: false"
      },
      limit: {
        type: "number",
        description: "Maximum number of entries to return. Default: 100. Set to 0 for no limit."
      }
    },
    
    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      const dirPath = args.path || '.';
      if (typeof dirPath !== 'string') {
        return { 
          valid: false, 
          reason: 'Directory path must be a string' 
        };
      }
      
      // Validate limit parameter if provided
      if (args.limit !== undefined) {
        const limit = Number(args.limit);
        if (isNaN(limit) || limit < 0) {
          return {
            valid: false,
            reason: 'Limit must be a non-negative number'
          };
        }
      }
      
      return { valid: true };
    },
    
    execute: async (args: LSToolArgs, context: ToolContext): Promise<LSToolResult> => {
      const { 
        path: dirPath = '.', 
        showHidden = false,
        details = false,
        limit = 100 // Default limit of 100 entries
      } = args;
      
      // Check if we're running in a sandbox (E2B)
      const isSandbox = !!process.env.SANDBOX_ROOT;
      
      if (isSandbox && path.isAbsolute(dirPath)) {
        // In sandbox mode, log warnings about absolute paths that don't match expected pattern
        const sandboxRoot = process.env.SANDBOX_ROOT || '/home/user/app';
        
        // If the path doesn't start with sandbox root, log a warning
        if (!dirPath.startsWith(sandboxRoot)) {
          context.logger?.warn(`Warning: LSTool: Using absolute path outside sandbox: ${dirPath}. This may fail.`);
        }
        
        // Keep the original path - no remapping
      }
      
      // Check cache first
      const cacheKey = `${dirPath}:${showHidden}:${details}`;
      const cachedResult = directoryCache.get(cacheKey);
      const now = Date.now();
      
      if (cachedResult && (now - cachedResult.timestamp) < CACHE_EXPIRATION) {
        // Use cached result
        const entries = limit > 0 ? cachedResult.entries.slice(0, limit) : cachedResult.entries;
        
        return {
          ok: true,
          data: {
            path: dirPath,
            entries,
            count: entries.length,
            totalCount: cachedResult.entries.length
          }
        };
      }
      
      // If not in cache or expired, get fresh data
      const executionAdapter = context.executionAdapter;
      const result = await executionAdapter.ls(context.executionId, dirPath, showHidden, details);
      
      if (result.ok) {
        // Apply limit if needed
        if (limit > 0 && result.data.entries.length > limit) {
          const limitedEntries = result.data.entries.slice(0, limit);
          
          // Cache the full result for future use
          directoryCache.set(cacheKey, {
            entries: result.data.entries,
            timestamp: now,
            showHidden,
            details
          });
          
          return {
            ok: true,
            data: {
              path: result.data.path,
              entries: limitedEntries,
              count: limitedEntries.length,
              totalCount: result.data.entries.length
            }
          };
        }
        
        // Cache the result for future use
        directoryCache.set(cacheKey, {
          entries: result.data.entries,
          timestamp: now,
          showHidden,
          details
        });
      }
      
      return result;
    }
  });
};
