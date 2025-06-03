/**
 * Types and interfaces for the main module
 *
 * This module re-exports the main public interfaces and types used by the agent.
 */

import type { Logger, LogLevel } from '../utils/logger.js';
import type { TypedEventEmitter } from '../utils/TypedEventEmitter.js';

import type { ProcessQueryResult } from './agent.js';
import { ConversationResult } from './agent.js';
import type { BusEvents } from './bus-events.js';
import type { ModelClient, SessionState, ModelProvider } from './model.js';
import type { PermissionManager } from './permission.js';
import type { ToolRegistry } from './registry.js';
import { ToolExecutionEvent, ToolExecutionStatus } from './tool-execution/index.js';
import type { Tool } from './tool.js';

// Re-export tool execution types
export { ToolExecutionEvent, ToolExecutionStatus };

// Define repository environment types
export type RepositoryEnvironment = { type: 'local' } | { type: 'docker' } | { type: 'remote' };

/**
 * Configuration options for creating a new agent
 * @interface CoreAgentConfig
 */
export interface CoreAgentConfig {
  /**
   * The model provider to use for generating responses
   * @example
   * ```typescript
   * const modelProvider = LLMFactory.createProvider({
   *   model: 'claude-3-7-sonnet-20250219'
   * });
   * ```
   */
  modelProvider: ModelProvider;

  /**
   * The execution environment configuration
   * @example
   * ```typescript
   * // Local environment (default)
   * const environment = { type: 'local' };
   *
   * // Docker environment
   * const environment = { type: 'docker' };
   *
   * // Remote environment
   * const environment = { type: 'remote' };
   * ```
   */
  environment: RepositoryEnvironment;

  /**
   * Optional default model to use when not specified in processQuery calls
   * This provides a fallback when model is not provided at runtime
   * @example
   * ```typescript
   * const config = {
   *   // other configuration...
   *   defaultModel: 'claude-3-7-sonnet-20250219'
   * };
   * ```
   */
  defaultModel?: string;

  /**
   * Custom system prompt – either a string or an object referencing a file.
   * If provided (and no explicit PromptManager is supplied), an internal
   * PromptManager will be constructed automatically with this prompt.
   */
  systemPrompt?: string | { file: string };

  /**
   * Optional logger interface for agent logs
   * If not provided, a default logger will be created
   */
  logger?: Logger;

  /**
   * Minimum log level for the built-in logger. Any message below this level
   * will be filtered out. If omitted, defaults to `LogLevel.INFO`.
   */
  logLevel?: LogLevel;

  /**
   * Optional UI handler for permission requests
   * If not provided, a default console-based handler will be used
   * @example
   * ```typescript
   * const permissionUIHandler = {
   *   async requestPermission(toolId, args) {
   *     // Custom UI logic to ask the user for permission
   *     console.log(`Tool ${toolId} requesting permission with args:`, args);
   *     return await showPermissionDialog(toolId, args);
   *   }
   * };
   * ```
   */
  permissionUIHandler?: {
    requestPermission: (
      sessionId: string,
      toolId: string,
      args: Record<string, unknown>,
    ) => Promise<boolean>;
  };

  /**
   * Optional prompt manager for customizing system prompts
   * If not provided, a default prompt manager will be created
   * @example
   * ```typescript
   * const promptManager = createPromptManager(`
   *   You are an AI assistant with the following capabilities:
   *   1. File operations
   *   2. Bash command execution
   *   3. Web search and retrieval
   * `);
   * ```
   */
  promptManager?: import('../core/PromptManager.js').PromptManager;

  /**
   * Whether prompt caching is enabled (depends on if the model provider supports it)
   * Defaults to true
   */
  cachingEnabled?: boolean;

  /**
   * Optional explicit tool list.  Each entry can be either the name of a
   * built-in tool (string) or an object that references a sub-agent via
   * `configFile`.
   *
   * Example:
   * ```jsonc
   * "tools": [
   *   "BashTool",
   *   { "name": "DocsAgent", "configFile": "./agents/docs/agent.json" }
   * ]
   * ```
   */
  tools?: Array<string | { name: string; configFile: string }>;

  /**
   * Runtime resolver for the remote execution sandbox/container identifier.
   * This is required when the execution `environment.type` is set to
   * `'remote'`.  The callback must return the identifier as a string.  The
   * resolution is performed lazily by the core implementation when the remote
   * adapter is first required.
   */
  getRemoteId?: (sessionId: string) => Promise<string>;

  /**
   * The per-agent event bus used for all lifecycle notifications.
   */
  eventBus: TypedEventEmitter<BusEvents>;
}

/**
 * The main Agent interface representing an AI agent capable of executing tools
 * and processing natural language queries.
 */
export interface Agent {
  // Core components
  toolRegistry: ToolRegistry;
  permissionManager: PermissionManager;
  modelClient: ModelClient;
  environment?: RepositoryEnvironment;
  logger: Logger;

  /**
   * Minimum log level for messages emitted by this agent.  Any log with a
   * severity below this threshold will be suppressed.  If omitted, the
   * default level is `info`.
   */
  logLevel?: LogLevel;

  // Helper methods
  /**
   * Process a single query with the agent
   * @param query The natural language query to process
   * @param model The model to use for this query
   * @param sessionState Optional session state (creates new session if not provided)
   * @returns A Promise resolving to the query result
   */
  processQuery(
    query: string,
    model: string,
    sessionState?: SessionState,
  ): Promise<ProcessQueryResult>;

  /**
   * Register a new tool with the agent
   * @param tool The tool to register
   */
  registerTool(tool: Tool): void;
}
