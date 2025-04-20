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

// Types
export { createContextWindow, ContextWindow } from '../types/contextWindow.js';
export { ToolExecutionState, ToolExecutionStatus, ToolExecutionEvent, PermissionRequestState, PermissionRequestedEventData, PermissionResolvedEventData, ToolExecutionManager } from '../types/tool-execution/index.js';
export { RepositoryInfo, CleanRepositoryStatus, DirtyRepositoryStatus, RepositoryStatus, GitRepositoryInfo } from '../types/repository.js';
export { ExecutionAdapter } from '../types/tool.js';
export { SessionState } from '../types/model.js';
export { ToolResultEntry } from '../types/agent.js';
export { RepositoryEnvironment } from '../types/main.js';
export { StructuredContent, ContentPart, TextContentPart, ImageContentPart, CodeBlockContentPart } from '../types/message.js';