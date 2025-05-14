/**
 * agent-core public API
 * 
 * This file exports the stable, public API surface for agent-core.
 */

// Primary API
export { Agent } from './Agent.js';
export { createAgent } from './core/Agent.js';
export { createTool } from './tools/createTool.js';
export { LLMFactory } from './providers/index.js';

// Event helpers (safe, read‑only API surface)
export {
  onAbortSession,
  onEnvironmentStatusChanged,
  onProcessingCompleted,
  // Checkpoint events
  onCheckpointReady,
  offCheckpointReady,
  CHECKPOINT_READY_EVENT,
  CheckpointEvents,
  // Rollback events
  onRollbackCompleted,
} from './events.js';
export type { 
  EnvironmentStatusEvent,
  CheckpointPayload 
} from './events.js';

// Rollback helper
export { rollbackSession } from './utils/RollbackManager.js';

export type {
  StructuredContent,
  TextContentPart,
  ContentPart,
  ToolCallReference,
  Message,
  MessageAddedEvent,
  MessageUpdatedEvent,
} from './types/message.js';

// Core types
export type { AgentConfig } from './types/main.js';
export type { Tool, ToolContext } from './types/tool.js';
export type { ToolParameter, ProcessQueryResult, ConversationResult, AgentMessage, AgentResponse, ToolResultEntry } from './types/agent.js';
export type { SessionState } from './types/model.js';

// Tool result types
export type {
  LSToolResult,
  LSToolSuccessResult,
  LSToolErrorResult,
  FileEntry,
  FileReadToolResult,
  FileReadToolSuccessResult,
  FileReadToolErrorResult,
  FileEditToolResult,
  FileEditToolSuccessResult,
  FileEditToolErrorResult
} from './tools/index.js';

// Checkpoint system exports
export { CheckpointingExecutionAdapter } from './utils/CheckpointingExecutionAdapter.js';
export type { SnapshotMeta } from './utils/CheckpointManager.js';