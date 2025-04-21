/**
 * agent-core public API
 * 
 * This file exports the stable, public API surface for agent-core.
 */

// Primary API
export { createAgent } from './core/Agent.js';
export { createTool } from './tools/createTool.js';

// Event helpers (safe, read‑only API surface)
export {
  onAbortSession,
  onEnvironmentStatusChanged,
  onProcessingCompleted,
  onMessageAdded,
  onMessageUpdated,
  offMessageAdded,
  offMessageUpdated,
} from './events.js';
export type { EnvironmentStatusEvent } from './events.js';

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
export type { Agent, AgentConfig } from './types/main.js';
export type { Tool, ToolContext } from './types/tool.js';
export type { ToolParameter } from './types/agent.js';

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