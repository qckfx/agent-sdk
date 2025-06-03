/**
 * Types and interfaces for the agent runner
 * @internal
 */

import { ModelClient } from './model.js';
import { PermissionManager } from './permission.js';
import { ToolRegistry } from './registry.js';
import { ExecutionAdapter } from './tool.js';
import { PromptManager } from '../core/PromptManager.js';
import { TypedEventEmitter } from '../utils/TypedEventEmitter.js';
import { BusEvents } from './bus-events.js';
import { Logger } from '../utils/logger.js';
import { ContextWindow } from './contextWindow.js';

/** @internal */
export interface AgentRunnerConfig {
  modelClient: ModelClient;
  toolRegistry: ToolRegistry;
  permissionManager: PermissionManager;
  executionAdapter: ExecutionAdapter;
  promptManager: PromptManager;
  eventBus: TypedEventEmitter<BusEvents>;
  logger: Logger;
}

/** @internal */
export interface ToolResultEntry {
  toolId: string;
  args: Record<string, unknown>;
  result: unknown;
  toolUseId?: string;
  /** Whether the tool execution was aborted */
  aborted?: boolean;
}

/** @internal */
export interface ProcessQueryResult {
  result?: {
    toolResults: ToolResultEntry[];
    iterations: number;
  };
  // Response may be undefined if a rollback occurred during the query.
  response?: string;
  contextWindow: ContextWindow;
  done: boolean;
  error?: string;
  /** Whether the operation was aborted */
  aborted?: boolean;
}

/** @internal */
export interface ConversationResult {
  responses: string[];
  sessionState: Record<string, unknown>;
}

/** @internal */
export interface AgentRunner {
  executionAdapter: ExecutionAdapter;
  promptManager: PromptManager;
  processQuery(
    query: string,
    model: string,
    sessionState?: Record<string, unknown>,
  ): Promise<ProcessQueryResult>;
}

// Legacy interfaces from the original agent.ts file
/** @internal */
export interface AgentMessage {
  role: string;
  content: string;
}

/** @internal */
export interface AgentResponse {
  text: string;
  [key: string]: unknown;
}

/**
 * Parameter definition for a tool
 */
export interface ToolParameter {
  name: string;
  description: string;
  type: string;
  required: boolean;
  default?: unknown;
}

/** @internal */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}
