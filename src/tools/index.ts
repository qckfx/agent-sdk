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
// ---------------------------------------------------------------------------
// Tool argument & result types – re-exported for convenience
// ---------------------------------------------------------------------------

// Bash
export type { BashToolArgs, BashToolResult } from './BashTool.js';

// Batch
export type { BatchToolArgs, BatchToolResult } from './BatchTool.js';

// File tools
export type { FileEditToolArgs, FileEditToolResult } from './FileEditTool.js';
export type { FileReadToolArgs, FileReadToolResult } from './FileReadTool.js';
export type { FileWriteToolArgs, FileWriteToolResult } from './FileWriteTool.js';

// Glob / Grep / LS
export type { GlobToolArgs, GlobToolResult } from './GlobTool.js';
export type { GrepToolArgs, GrepToolResult } from './GrepTool.js';
export type { LSToolArgs, LSToolResult, FileEntry } from './LSTool.js';
