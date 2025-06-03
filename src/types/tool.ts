/**
 * Types and interfaces for tools
 */

import type { FileEditToolResult } from '../tools/FileEditTool.js';
import type { FileReadToolResult } from '../tools/FileReadTool.js';
import type { LSToolResult } from '../tools/LSTool.js';
import type { Logger } from '../utils/logger.js';

import type { SessionState } from './model.js';
import type { PermissionManager } from './permission.js';
import type { GitRepositoryInfo } from './repository.js';
import type { ToolResult } from './tool-result.js';


/**
 * Categories for tools to classify their purpose and permission requirements
 */
export enum ToolCategory {
  FILE_OPERATION = 'file_operation',
  SHELL_EXECUTION = 'shell_execution',
  READONLY = 'readonly',
  NETWORK = 'network',
}

export interface ExecutionAdapter {
  executeCommand: (
    executionId: string,
    command: string,
    workingDir?: string,
    checkpoint?: boolean,
    timeoutMs?: number,
    maxBuffer?: number,
  ) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;

  editFile: (
    executionId: string,
    filepath: string,
    searchCode: string,
    replaceCode: string,
    encoding?: string,
  ) => Promise<FileEditToolResult>;

  glob: (executionId: string, pattern: string, options?: any) => Promise<string[]>;

  readFile: (
    executionId: string,
    filepath: string,
    maxSize?: number,
    lineOffset?: number,
    lineCount?: number,
    encoding?: string,
  ) => Promise<FileReadToolResult>;

  writeFile: (
    executionId: string,
    filepath: string,
    content: string,
    encoding?: string,
  ) => Promise<void>;

  ls: (
    executionId: string,
    dirPath: string,
    showHidden?: boolean,
    details?: boolean,
  ) => Promise<LSToolResult>;

  /**
   * Generates a structured directory map for the specified path
   * @param rootPath The root directory to map
   * @param maxDepth Maximum depth to traverse (default: 10)
   * @returns A formatted directory structure as a string in context tag format
   */
  generateDirectoryMap: (rootPath: string, maxDepth?: number) => Promise<string>;

  /**
   * Retrieves git repository information for all repositories
   * @returns Array of git repository information (empty if no repositories)
   */
  getGitRepositoryInfo: () => Promise<GitRepositoryInfo[]>;

  /**
   * Retrieves directory structures for all repositories
   * @returns Map of repository root paths to their directory structure strings
   */
  getDirectoryStructures: () => Promise<Map<string, string>>;
}

export interface ParameterSchema {
  type: string;
  description?: string;
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ToolConfig<Res extends ToolResult = ToolResult> {
  id: string;
  name: string;
  description: string;
  requiresPermission?: boolean;
  parameters?: Record<string, ParameterSchema>;
  requiredParameters?: string[];

  /**
   * Categorize tools for permission management and feature grouping
   * Can be a single category or an array of categories if tool fits multiple purposes
   */
  category?: ToolCategory | ToolCategory[];

  /**
   * Whether this tool should always require permission regardless of fast edit mode
   * Tools like BashTool should set this to true for security
   */
  alwaysRequirePermission?: boolean;

  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<Res>;
  validateArgs?: (args: Record<string, unknown>) => ValidationResult;
}

export interface ToolContext {
  executionId: string;
  permissionManager?: PermissionManager;
  logger?: Logger;
  executionAdapter: ExecutionAdapter;
  toolRegistry?: {
    getAllTools: () => Tool[];
    getTool: (toolId: string) => Tool | undefined;
  };
  sessionState: SessionState;
  /** AbortSignal for cooperative cancellation */
  abortSignal?: AbortSignal;
  [key: string]: unknown;
}

export interface Tool<Res extends ToolResult = ToolResult> {
  id: string;
  name: string;
  description: string;
  requiresPermission: boolean;
  parameters: Record<string, ParameterSchema>;
  requiredParameters: string[];

  /**
   * Categorize tools for permission management and feature grouping
   * Can be a single category or an array of categories if tool fits multiple purposes
   */
  category?: ToolCategory | ToolCategory[];

  /**
   * Whether this tool should always require permission regardless of fast edit mode
   * Tools like BashTool should set this to true for security
   */
  alwaysRequirePermission?: boolean;

  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<Res>;
}
