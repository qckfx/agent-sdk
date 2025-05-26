/**
 * GrepTool - Searches file contents for patterns
 */

// path import removed as it's unused
import { promisify } from 'util';
import { exec } from 'child_process';
import { createTool } from './createTool.js';
import { Tool, ToolContext, ValidationResult, ToolCategory } from '../types/tool.js';
import { ToolResult } from '../types/tool-result.js';

const execAsync = promisify(exec);

// ------------------------------------------------------------
// Public argument & result helper types
// ------------------------------------------------------------

export interface GrepToolArgs {
  /** Search pattern (plain text or regex) */
  pattern: string;
  /** Directory or file path to search.  Defaults to '.' */
  path?: string;
  /** Search recursively?  Defaults to true */
  recursive?: boolean;
  /** Case-insensitive search? */
  ignoreCase?: boolean;
  /** Glob pattern to restrict files */
  filePattern?: string;
  /** Maximum number of results to return.  Defaults to 100 */
  maxResults?: number;
}

// Internal helper interface for parsed grep output lines
interface GrepResult {
  file?: string;
  line?: number;
  content?: string;
  raw?: string;
}

interface GrepToolData {
  pattern: string;
  path: string;
  results: GrepResult[];
  count: number;
  hasMore: boolean;
  truncated: boolean; // Flag to indicate if results were truncated
  totalMatches: number; // Original count before truncation
}

export type GrepToolResult = ToolResult<GrepToolData>;

/**
 * Creates a tool for searching file contents
 * @returns The grep tool interface
 */
export const createGrepTool = (): Tool<GrepToolResult> => {
  return createTool({
    id: 'grep',
    name: 'GrepTool',
    description: '- Fast content search tool that works across the codebase\n- Searches file contents using patterns or regular expressions\n- Supports recursive directory traversal\n- Filters files by pattern to narrow search scope\n- Use this tool when you need to find specific text in file contents\n- For finding files by name, use GlobTool instead\n\nUsage notes:\n- Provide a search pattern to find matching content in files\n- Use ignoreCase=true for case-insensitive searching\n- Limit search to specific file types with filePattern\n- Search within a specific directory using the path parameter\n- Results are limited by maxResults to prevent overwhelming output\n- For complex content searches, consider using multiple tool calls\n\nExample call:\n            { "pattern": "function.*create", "path": "src", "filePattern": "*.ts", "ignoreCase": true }',
    requiresPermission: false, // Reading/searching is generally safe
    category: ToolCategory.READONLY,
    
    // Enhanced parameter descriptions
    parameters: {
      pattern: {
        type: "string",
        description: "Search pattern to look for in files. Can be plain text or regular expressions."
      },
      path: {
        type: "string",
        description: "Directory or file path to search in. Can be relative like 'src', '../' or absolute. Default: current directory"
      },
      recursive: {
        type: "boolean",
        description: "Whether to search recursively in subdirectories. Default: true"
      },
      ignoreCase: {
        type: "boolean",
        description: "Whether to ignore case when matching. Default: false"
      },
      filePattern: {
        type: "string",
        description: "Optional glob pattern to filter which files to search. Example: '*.js', '*.{js,ts}'"
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return. Default: 100"
      }
    },
    requiredParameters: ["pattern"],
    
    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (!args.pattern || typeof args.pattern !== 'string') {
        return { 
          valid: false, 
          reason: 'Search pattern must be a string' 
        };
      }
      
      if (args.path && typeof args.path !== 'string') {
        return {
          valid: false,
          reason: 'Path must be a string'
        };
      }
      
      return { valid: true };
    },
    
    execute: async (args: Record<string, unknown>, context: ToolContext): Promise<GrepToolResult> => {
      if (context.abortSignal?.aborted) {
        throw new Error('AbortError');
      }

      // Extract and type-cast each argument individually
      const pattern = args.pattern as string;
      const searchPath = args.path as string || '.';
      const recursive = args.recursive as boolean ?? true;
      const ignoreCase = args.ignoreCase as boolean || false;
      const filePattern = args.filePattern as string || '*';
      const maxResults = args.maxResults as number || 100;
      
      try {
        // Build the grep command
        // Using grep directly is more efficient than implementing in JS
        let command = 'grep';
        
        // Add options
        if (recursive) command += ' -r';
        if (ignoreCase) command += ' -i';
        
        // Add pattern (escape for shell)
        const escapedPattern = pattern.replace(/'/g, "'\\\\'");
        command += ` '${escapedPattern}'`;
        
        // Add path and file pattern
        if (filePattern !== '*') {
          // Use find to filter files first
          command = `find ${searchPath} -type f -name "${filePattern}" -exec ${command} {} \\;`;
        } else {
          command += ` ${searchPath}`;
        }
        
        // Add result limiting
        command += ` | head -n ${maxResults}`;
        
        // Execute the command
        context.logger?.debug(`Executing grep: ${command}`);
        // We need stdout but stderr is unused
        const { stdout } = await context.executionAdapter.executeCommand(context.executionId, command);
        
        // Parse the results
        const lines = stdout.trim().split('\n');
        let results: GrepResult[] = lines
          .filter(line => line.trim() !== '')
          .map(line => {
            // Try to parse the grep output format (filename:line:content)
            const match = line.match(/^([^:]+):(\d+):(.*)$/);
            if (match) {
              // Convert absolute file paths to more manageable relative paths
              const filePath = match[1];
              const relativePath = filePath.startsWith(searchPath) && searchPath !== '.' ? 
                filePath.substring(searchPath.length + 1) : filePath;
              
              return {
                file: relativePath,
                line: parseInt(match[2], 10),
                content: match[3]
              };
            }
            return { raw: line };
          });
        
        // Track total matches before potential truncation
        const totalMatches = results.length;
        
        // Handle large result sets - if there are too many matches, truncate
        // to avoid exceeding message size limits
        const MAX_RESULTS_SIZE = 30; // Limit to 30 results max to avoid token limits
        let truncated = false;
        
        if (results.length > MAX_RESULTS_SIZE) {
          context.logger?.info(`GrepTool: Truncating ${results.length} results to ${MAX_RESULTS_SIZE} to avoid message size limits`);
          results = results.slice(0, MAX_RESULTS_SIZE);
          truncated = true;
        }
        
        return {
          ok: true,
          data: {
            pattern,
            path: searchPath,
            results,
            count: results.length,
            hasMore: results.length >= maxResults || truncated,
            truncated,
            totalMatches
          }
        };
      } catch (error: unknown) {
        // Check if it's just "no results" error
        if ((error as { code?: number }).code === 1 && !(error as { stderr?: string }).stderr) {
          return {
            ok: true,
            data: {
              pattern,
              path: searchPath,
              results: [],
              count: 0,
              hasMore: false,
              truncated: false,
              totalMatches: 0
            }
          };
        }
        
        context.logger?.error(`Error in grep search: ${(error as Error).message}`);
        return {
          ok: false,
          error: (error as Error).message
        };
      }
    }
  });
};
