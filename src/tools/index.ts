/**
 * Built-in tool factories and types
 *
 * Re-exports all built-in tool factories and their result types for convenience.
 */

// Tool factories
export { createBashTool } from './BashTool.js';
export { createBatchTool } from './BatchTool.js';
export { createFileEditTool } from './FileEditTool.js';
export { createFileReadTool } from './FileReadTool.js';
export { createFileWriteTool } from './FileWriteTool.js';
export { createGlobTool } from './GlobTool.js';
export { createGrepTool } from './GrepTool.js';
export { createLSTool } from './LSTool.js';
export { createThinkTool } from './ThinkTool.js';

// Tool result types - using export type for type-only exports
export type { 
  FileEditToolArgs,
  FileEditToolResult, 
  FileEditToolSuccessResult, 
  FileEditToolErrorResult
} from './FileEditTool.js';

export type { 
  FileReadToolArgs,
  FileReadToolResult, 
  FileReadToolSuccessResult, 
  FileReadToolErrorResult
} from './FileReadTool.js';

export type { 
  LSToolResult, 
  LSToolSuccessResult, 
  LSToolErrorResult,
  FileEntry
} from './LSTool.js';