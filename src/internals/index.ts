/**
 * Internal APIs - No stability guarantees
 * 
 * This barrel exports internal implementation details that may change without notice.
 * These exports are not covered by semver guarantees and should only be used by
 * advanced users who are willing to keep up with potentially breaking changes.
 */

// Core internals
export { createAgentRunner } from '../core/AgentRunner.js';
export { createToolRegistry } from '../core/ToolRegistry.js';
export { createPermissionManager } from '../core/PermissionManager.js';
export { createDefaultPromptManager, createPromptManager, PromptManager } from '../core/PromptManager.js';

// Utils
export { createExecutionAdapter, ExecutionAdapterFactoryOptions, ExecutionAdapterType } from '../utils/ExecutionAdapterFactory.js';
export { isSessionAborted, setSessionAborted, clearSessionAborted } from '../utils/sessionUtils.js';

// Types - using 'export type' to ensure they're only used for type checking
export { createContextWindow } from '../types/contextWindow.js';
export { ContextWindow } from '../types/contextWindow.js';
export type { 
  ToolExecutionState,  
  ToolExecutionEvent, 
  PermissionRequestState, 
  PermissionRequestedEventData, 
  PermissionResolvedEventData, 
  ToolExecutionManager 
} from '../types/tool-execution/index.js';
// Not a type, an enum
export {
  ToolExecutionStatus,
} from '../types/tool-execution/index.js';
export type { 
  RepositoryInfo, 
  CleanRepositoryStatus, 
  DirtyRepositoryStatus, 
  RepositoryStatus, 
  GitRepositoryInfo 
} from '../types/repository.js';
export type { ExecutionAdapter } from '../types/tool.js';
export type { RepositoryEnvironment } from '../types/main.js';
export type { 
  StructuredContent, 
  ContentPart, 
  TextContentPart, 
  ImageContentPart, 
  CodeBlockContentPart
} from '../types/message.js';
export { parseStructuredContent } from '../types/message.js';

// Constant event names (but not the EventEmitter instance)
export type { AgentEventType, EnvironmentStatusEvent } from '../utils/sessionUtils.js';