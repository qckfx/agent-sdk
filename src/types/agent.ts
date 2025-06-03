/**
 * Types and interfaces for the agent runner
 * @internal
 */

import type { PromptManager } from '../core/PromptManager.js';
import type { Logger } from '../utils/logger.js';
import type { TypedEventEmitter } from '../utils/TypedEventEmitter.js';

import type { BusEvents } from './bus-events.js';
import type { ContextWindow } from './contextWindow.js';
import type { ModelClient } from './model.js';
import type { PermissionManager } from './permission.js';
import type { ToolRegistry } from './registry.js';
import type { ExecutionAdapter } from './tool.js';




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
