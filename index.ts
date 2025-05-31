/**
 * agent-core – Public entry point
 *
 * This root barrel intentionally exposes **only** the minimal, stable API
 * surface required to work with an `Agent` instance.  All other modules,
 * helpers and built-in tools remain internal implementation details and are
 * deliberately *not* exported here so that they can evolve without breaking
 * consumers.
 */

// ---------------------------------------------------------------------------
// Primary class & helper
// ---------------------------------------------------------------------------

export { Agent } from './src/Agent.js';
export { AgentConfig } from '@qckfx/sdk-schema';
export { createTool } from './src/tools/createTool.js';

// ---------------------------------------------------------------------------
// Public types – re-exported for developer ergonomics
// ---------------------------------------------------------------------------

// Tooling
export type {
  Tool,
  ToolContext,
} from './src/types/tool.js';

export { ToolRegistry } from './src/types/registry.js';

export type {
  ToolDescription,
} from './src/types/registry.js';

export type {
  ToolExecutionState,
  PermissionRequestState
} from './src/types/tool-execution/index.js';

export { ToolExecutionStatus } from './src/types/tool-execution/index.js';

// Runtime results
export type {
  ProcessQueryResult,
  ConversationResult,
  ToolResultEntry,
} from './src/types/agent.js';

// Tool Results
export type {
  ToolResult,
  ToolSuccess,
  ToolError,
  FileEditToolData,
  FileReadToolData,
  LSToolData,
  BashToolData,
  GrepToolData,
  GlobToolData,
  FileEditToolResult,
  FileReadToolResult,
  LSToolResult,
  BashToolResult,
  GrepToolResult,
  GlobToolResult,
} from './src/types/tool-result.js';

// ---------------------------------------------------------------------------
// Tool Argument types – exported for convenience
// ---------------------------------------------------------------------------

export type {
  BashToolArgs,
  BatchToolArgs,
  FileReadToolArgs,
  FileEditToolArgs,
  FileWriteToolArgs,
  GlobToolArgs,
  GrepToolArgs,
  LSToolArgs,
} from './src/tools/index.js';

// ---------------------------------------------------------------------------
// Additional supporting types for tools – for authoring custom tools
// ---------------------------------------------------------------------------

export type {
  // Core tool config & helpers
  ToolConfig,
  ParameterSchema,
  ValidationResult,
  ExecutionAdapter,
} from './src/types/tool.js';

// Enum export (value + type)
export { ToolCategory } from './src/types/tool.js';

// Convenience export for common sub-types used in tool results
export type { FileEntry } from './src/tools/LSTool.js';

export {
  ContextWindow,
} from './src/types/contextWindow.js';

export type {
  Message
} from './src/types/contextWindow.js';

export type {
  CheckpointData,
  EnvironmentStatusData,
  PermissionData,
  ProcessingCompletedData,
  ProcessingErrorData,
  ProcessingStartedData,
} from './src/types/events.js';

export { BusEvent, BusEvents } from './src/types/bus-events.js';

// Nothing else is exported – **intentional**.
