/**
 * agent-core public API
 * 
 * This file exports the stable, public API surface for agent-core.
 */

// Primary API
export { createAgent } from './core/Agent.js';
export { createTool } from './tools/createTool.js';

// Event constants
export { MESSAGE_ADDED, MESSAGE_UPDATED, AgentEventType, AgentEvents, EnvironmentStatusEvent } from './events.js';

// Core types
export { Agent, AgentConfig } from './types/main.js';
export { Tool, ToolContext } from './types/tool.js';
export { ToolParameter } from './types/agent.js';

// Tool result types
export {
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
