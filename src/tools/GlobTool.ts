/**
 * GlobTool - Finds files using glob patterns
 */

import path from 'path';
import { glob } from 'glob';
import { createTool } from './createTool.js';
import { Tool, ToolContext, ValidationResult, ToolCategory } from '../types/tool.js';
import { ToolResult } from '../types/tool-result.js';

/**
 * The `glob` function from `glob@^10` already returns a `Promise` when no
 * callback is supplied, so we can use it directly.  Wrapping it with
 * `util.promisify` (as done previously) results in a promise that never
 * resolves because the library no longer invokes the callback form.  That
 * caused GlobTool to appear to “hang”.
 */
const globAsync = (pattern: string, options: any): Promise<string[]> => {
  return glob(pattern, options) as Promise<string[]>;
};

// Used for type checking in execute function
export interface GlobToolArgs {
  pattern: string;
  cwd?: string;
  dot?: boolean;
  nodir?: boolean;
  maxResults?: number;
}

interface GlobToolData {
  pattern: string;
  cwd: string;
  matches: string[];
  count: number;
  hasMore: boolean;
  truncated: boolean; // Flag to indicate if results were truncated
  totalMatches: number; // Original count before truncation
}

export type GlobToolResult = ToolResult<GlobToolData>;

/**
 * Creates a tool for finding files using glob patterns
 * @returns The glob tool interface
 */
export const createGlobTool = (): Tool<GlobToolResult> => {
  return createTool({
    id: 'glob',
    name: 'GlobTool',
    description: '- Fast file pattern matching tool that works across the codebase\n- Searches for files based on name patterns (not content)\n- Supports powerful glob patterns for flexible matching\n- Provides options to filter results by type and attributes\n- Use this tool when you need to find files by name patterns\n- For searching file contents, use GrepTool instead\n\nUsage notes:\n- Glob patterns use wildcards to match filenames\n- Common patterns: \'**/*.js\' (all JS files), \'src/**/*.ts\' (all TS files in src)\n- Use the dot option to include hidden files (starting with \'.\')\n- Use nodir to exclude directories from results\n- Results are LIMITED TO MAX 100 FILES regardless of maxResults parameter\n- For large codebases, use more specific patterns to limit results\n- If you need to search comprehensively, make multiple targeted tool calls\n\nExample call:\n            { "pattern": "**/*.ts", "cwd": "src", "nodir": true }',
    requiresPermission: false, // Finding files is generally safe
    category: ToolCategory.READONLY,
    
    // Enhanced parameter descriptions
    parameters: {
      pattern: {
        type: "string",
        description: "The glob pattern to match files. Examples: '**/*.js', 'src/**/*.json', '*.md'"
      },
      cwd: {
        type: "string",
        description: "Base directory for the search. Use relative paths like 'src', '../', 'docs/v2' or absolute paths. Default: current directory ('.')"
      },
      dot: {
        type: "boolean",
        description: "Include .dot files in the search results. Default: false"
      },
      nodir: {
        type: "boolean",
        description: "Only return files (not directories) in the results. Default: false"
      },
      maxResults: {
        type: "number",
        description: "Limit number of results returned. Default: 1000"
      }
    },
    requiredParameters: ["pattern"],
    
    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (!args.pattern || typeof args.pattern !== 'string') {
        return { 
          valid: false, 
          reason: 'Glob pattern must be a string' 
        };
      }
      return { valid: true };
    },
    
    execute: async (args: Record<string, unknown>, context: ToolContext): Promise<GlobToolResult> => {
      // Extract and type-cast each argument individually
      const pattern = args.pattern as string;
      const cwd = args.cwd as string || '.';
      const dot = args.dot as boolean || false;
      const nodir = args.nodir as boolean || false;
      const maxResults = args.maxResults as number || 1000;
      
      try {
        // Check if we're running in a sandbox (E2B)
        const isSandbox = !!process.env.SANDBOX_ROOT;
        
        if (isSandbox && path.isAbsolute(cwd)) {
          // In sandbox mode, log warnings about absolute paths that don't match expected pattern
          const sandboxRoot = process.env.SANDBOX_ROOT || '/home/user/app';
          
          // If the path doesn't start with sandbox root, log a warning
          if (!cwd.startsWith(sandboxRoot)) {
            context.logger?.warn(`Warning: GlobTool: Using absolute path outside sandbox: ${cwd}. This may fail.`);
          }
        } 
        
        // Set up glob options
        const options = {
          cwd: cwd,
          dot: dot, // Include .dot files if true
          nodir: nodir, // Only return files (not directories) if true
          absolute: true, // Return absolute paths
          nosort: false, // Sort the results
          silent: true, // Don't throw on permission errors etc.
          limit: Math.min(maxResults, 100) // Hard cap at 100 results to prevent context overflow
        };
        
        // Execute the glob
        context.logger?.debug(`Executing glob: ${pattern} in ${cwd}`);
        let matches = await context.executionAdapter.glob(context.executionId, pattern, options);
        
        // Track the total number of matches before truncation
        const totalMatches = matches.length;
        
        // Convert absolute paths to relative paths for better readability
        matches = matches.map((filePath: string) => {
          // If the cwd is "." (current directory), use path.relative with process.cwd()
          if (cwd === '.') {
            return path.relative(process.cwd(), filePath);
          }
          // Otherwise, for absolute paths, make them relative to the specified cwd
          if (path.isAbsolute(filePath) && path.isAbsolute(cwd)) {
            return path.relative(cwd, filePath);
          }
          return filePath;
        });
        
        // Handle large result sets - if there are too many matches, we need to truncate
        // to avoid exceeding message size limits (approximating 500 chars per file path)
        const MAX_RESULTS_SIZE = 40; // Limit to 40 results max to avoid token limits
        let truncated = false;
        
        if (matches.length > MAX_RESULTS_SIZE) {
          context.logger?.info(`GlobTool: Truncating ${matches.length} results to ${MAX_RESULTS_SIZE} to avoid message size limits`);
          matches = matches.slice(0, MAX_RESULTS_SIZE);
          truncated = true;
        }
        
        return {
          ok: true,
          data: {
            pattern,
            cwd: cwd,
            matches,
            count: matches.length,
            hasMore: matches.length >= options.limit || truncated,
            truncated: truncated,
            totalMatches: totalMatches
          }
        };
      } catch (error: unknown) {
        const err = error as Error;
        context.logger?.error(`Error in glob search: ${err.message}`);
        return {
          ok: false,
          error: err.message
        };
      }
    }
  });
};