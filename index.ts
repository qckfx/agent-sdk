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
export { AgentConfigJSON } from './schemas/agent-config.zod.js';
export { createTool } from './src/tools/createTool.js';

// ---------------------------------------------------------------------------
// Public types – re-exported for developer ergonomics
// ---------------------------------------------------------------------------

export type {
  // Configuration & state
  AgentConfig,
} from './src/types/main.js';

// Tooling
export type {
  Tool,
  ToolContext,
} from './src/types/tool.js';

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

// Stuff on SessionState
export type {
  SessionState
} from './src/types/model.js';

export {
  ContextWindow,
} from './src/types/contextWindow.js';

// Messaging helpers
export type {
  StructuredContent,
  TextContentPart,
  ContentPart,
  ToolCallReference,
  Message,
  MessageAddedEvent,
  MessageUpdatedEvent,
} from './src/types/message.js';

export type {
  CheckpointData,
  EnvironmentStatusData,
  PermissionData,
  ProcessingCompletedData,
  ProcessingErrorData,
  ProcessingStartedData,
} from './src/types/events.js';

// Utility helpers
export { parseStructuredContent } from './src/types/message.js';

// Instance event system
export type { AgentEvent, AgentEventMap } from './src/types/events.js';

export { ProcessingEvents, ToolExecutionEvents, EnvironmentEvents, CheckpointEvents } from './src/types/events.js';

// Nothing else is exported – **intentional**.
