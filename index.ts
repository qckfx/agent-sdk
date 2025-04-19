/**
 * agent-core - AI Agent SDK
 * Public API exports
 */

// Re-export the factory function
export { createAgent } from './src/index.js';

// Export events as a namespace
export * as Events from './src/events.js';

// Export event constants directly
export { 
  MESSAGE_ADDED, 
  MESSAGE_UPDATED, 
  AgentEventType,
  AgentEvents
} from './src/events.js';

// Export types from tool-execution
export {
  ToolExecutionState,
  ToolExecutionStatus,
  ToolExecutionEvent,
  PermissionRequestState,
  PermissionRequestedEventData,
  PermissionResolvedEventData,
  ToolExecutionManager
} from './src/types/tool-execution/index.js';

// Export types from model.ts
export {
  SessionState,
  ModelClient,
  ModelProvider,
  ModelClientConfig,
  ToolCall,
  ModelProviderRequest,
  TokenManager
} from './src/types/model.js';

// Export types from message.ts
export {
  StructuredContent,
  ContentPart,
  TextContentPart,
  ImageContentPart,
  CodeBlockContentPart,
  parseStructuredContent
} from './src/types/message.js';

// Export types from repository.ts
export {
  RepositoryInfo,
  CleanRepositoryStatus,
  DirtyRepositoryStatus,
  RepositoryStatus,
  GitRepositoryInfo
} from './src/types/repository.js';

// Export types from agent.ts
export {
  AgentRunner,
  ProcessQueryResult,
  ConversationResult,
  ToolResultEntry,
  ToolDefinition,
  ToolParameter
} from './src/types/agent.js';

// Export types from config.ts
export {
  LoggerConfig,
  PermissionConfig,
  AgentConfig
} from './src/types/config.js';

// Export from main.ts
export {
  RepositoryEnvironment,
  Agent
} from './src/types/main.js';

// Export utility functions
export {
  createLogger,
  Logger,
  LogLevel,
  LogCategory
} from './src/utils/logger.js';

export {
  setSessionAborted,
  isSessionAborted,
  clearSessionAborted
} from './src/utils/sessionUtils.js';

export {
  createExecutionAdapter
} from './src/utils/ExecutionAdapterFactory.js';

// Export provider-related functions
export {
  createAnthropicProvider,
  AnthropicProvider
} from './src/providers/AnthropicProvider.js';

// Export specific tool types
export {
  Tool,
  ToolContext,
  ToolCategory,
  ExecutionAdapter,
  ParameterSchema
} from './src/types/tool.js';

// Export core creation functions
export {
  createPromptManager,
  PromptManager
} from './src/core/PromptManager.js';