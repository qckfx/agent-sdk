/**
 * Types and interfaces for model clients
 */

import Anthropic from '@anthropic-ai/sdk';
import { ToolDescription, ToolRegistry } from './registry.js';
import { PromptManager } from '../core/PromptManager.js';
import { Logger } from '../utils/logger.js';
import { ExecutionAdapter } from './tool.js';
import { ContextWindow } from './contextWindow.js';
import { LastToolError } from './tool-result.js';

export interface ToolCall {
  toolId: string;
  args: unknown;
  toolUseId: string;
}

export interface ToolCallResponse {
  toolCall?: ToolCall;
  toolChosen: boolean;
  response?: Anthropic.Messages.Message;
  /** Whether the operation was aborted */
  aborted?: boolean;
}

export type MessageTokenUsage = {
  messageIndex: number;
  tokens: number;
};

export type TokenUsage = {
  totalTokens: number;
  tokensByMessage: MessageTokenUsage[];
};

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: Anthropic.Messages.ContentBlock[];
}

/**
 * Cache metrics for tracking prompt caching efficiency 
 */
export interface CacheMetricsTracking {
  totalCacheWrites: number;
  totalCacheReads: number;
  lastRequestMetrics?: {
    creation: number;
    read: number;
    input: number;
  };
}

export interface SessionState {
  id: string;
  /** Conversation context with file tracking */
  contextWindow: ContextWindow;
  
  lastToolError?: LastToolError;
  tokenUsage?: TokenUsage;
  /** Shared AbortController for the session - always present */
  abortController: AbortController;
  /** Optional timestamp when the session was aborted */
  abortedAt?: number;
  /** Cache metrics for tracking prompt caching performance */
  cacheMetrics?: CacheMetricsTracking;
  /** Execution adapter type */
  executionAdapterType?: 'local' | 'docker' | 'remote';
  /** Remote ID if using remote execution */
  remoteId?: string;
  /** Execution adapter instance */
  executionAdapter?: ExecutionAdapter;
  /** API key for the LLM provider - takes precedence over environment variables */
  llmApiKey?: string;
  /** Multi-repo session tracking */
  multiRepoTracking?: {
    /** Number of repositories being tracked in this session */
    repoCount: number;
    /** Repository paths being managed */
    repoPaths: string[];
    /** Whether directory structure has been generated for this session */
    directoryStructureGenerated: boolean;
    /** Last multi-repo checkpoint metadata */
    lastCheckpointMetadata?: {
      toolExecutionId: string;
      timestamp: string;
      repoCount: number;
      hostCommits: Record<string, string>; // repo path -> commit sha (serializable)
    };
  };

  [key: string]: unknown;
}

export interface ModelProviderRequest {
  query?: string;
  tools?: unknown[];
  tool_choice?: { type: string };
  encourageToolUse?: boolean;
  systemMessage?: string; // Kept for backward compatibility
  systemMessages?: string[]; // New array-based system messages
  temperature: number;
  toolErrorContext?: {
    toolId: string;
    error: string;
    args: Record<string, unknown>;
  };
  sessionState?: SessionState;
  cachingEnabled?: boolean; // Whether to enable prompt caching
  model: string; // Required model parameter
}

export type ModelProvider = (request: ModelProviderRequest) => Promise<Anthropic.Messages.Message>;

export interface ModelClientConfig {
  modelProvider: ModelProvider;
  promptManager?: PromptManager;
  toolRegistry?: ToolRegistry;
}

export interface ModelClient {
  formatToolsForClaude(toolDescriptions: ToolDescription[]): unknown[];
  getToolCall(
    query: string,
    model: string,
    toolDescriptions: ToolDescription[],
    sessionState?: SessionState,
    options?: { signal?: AbortSignal }
  ): Promise<ToolCallResponse>;
  generateResponse(
    query: string,
    model: string,
    toolDescriptions: ToolDescription[], 
    sessionState?: SessionState, 
    options?: { tool_choice?: { type: string }; signal?: AbortSignal }
  ): Promise<Anthropic.Messages.Message>;
}

// TokenManager interface for conversation compression
export interface TokenManager {
  manageConversationSize: (
    sessionState: SessionState, 
    maxTokens: number,
    logger?: Logger
  ) => void;
}