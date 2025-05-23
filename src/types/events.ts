/**
 * Event types and interfaces for agent events
 * @module Events
 */

/**
 * Constants for processing lifecycle events
 */
export const ProcessingEvents = {
  STARTED: 'processing:started',
  COMPLETED: 'processing:completed',
  ERROR: 'processing:error',
  ABORTED: 'processing:aborted'
} as const;

/**
 * Constants for tool execution events
 */
export const ToolExecutionEvents = {
  STARTED: 'tool:execution:started',
  COMPLETED: 'tool:execution:completed',
  ERROR: 'tool:execution:error'
} as const;

/**
 * Constants for environment events
 */
export const EnvironmentEvents = {
  STATUS_CHANGED: 'environment:status_changed'
} as const;

/**
 * Constants for checkpoint events
 */
export const CheckpointEvents = {
  READY: 'checkpoint:ready'
} as const;

/**
 * Constants for rollback events
 */
export const RollbackEvents = {
  COMPLETED: 'rollback:completed'
} as const;

/**
 * Constants for permission events
 */
export const PermissionEvents = {
  REQUESTED: 'permission:requested'
} as const;

/**
 * Union type for all agent events
 * Events follow a namespace:action pattern for clarity
 */
export type AgentEvent =
  // Processing lifecycle events
  | typeof ProcessingEvents[keyof typeof ProcessingEvents]
  // Tool execution events
  | typeof ToolExecutionEvents[keyof typeof ToolExecutionEvents]
  // Environment events
  | typeof EnvironmentEvents[keyof typeof EnvironmentEvents]
  // Checkpoint events
  | typeof CheckpointEvents[keyof typeof CheckpointEvents]
  // Rollback events
  | typeof RollbackEvents[keyof typeof RollbackEvents]
  // Permission events
  | typeof PermissionEvents[keyof typeof PermissionEvents];

/**
 * Event data for processing started event
 */
export interface ProcessingStartedData {
  sessionId: string;
  query: string;
  model: string;
}

/**
 * Event data for processing completed event
 */
export interface ProcessingCompletedData {
  sessionId: string;
  response: string;
  executionTime?: number;
}

/**
 * Event data for processing error event
 */
export interface ProcessingErrorData {
  sessionId: string;
  error: {
    message: string;
    stack?: string;
  };
}

/**
 * Environment status event data
 */
export interface EnvironmentStatusData {
  environmentType: 'local' | 'docker' | 'remote';
  status: 'initializing' | 'connecting' | 'connected' | 'disconnected' | 'error';
  isReady: boolean;
  error?: string;
}

/**
 * Checkpoint event data (supports both single and multi-repo scenarios)
 */
export interface CheckpointData {
  sessionId: string;
  toolExecutionId: string;
  hostCommits: Map<string, string>; // repo path -> commit sha
  shadowCommits: Map<string, string>; // repo path -> shadow commit sha
  bundles: Map<string, Uint8Array>; // repo path -> bundle
  repoCount: number;
  timestamp: string;
}

/**
 * Rollback event data (supports both single and multi-repo scenarios)
 */
export interface RollbackData {
  sessionId: string;
  commitSha: string; // First repo's commit SHA for backwards compatibility
  restoredCommits: Map<string, string>; // repo path -> commit sha
  repoCount: number;
}

/**
 * Permission event data
 */
export interface PermissionData {
  toolId: string;
  args: Record<string, unknown>;
}

/**
 * Map of event names to their data types
 * This allows for type-safe event handling
 */
export interface AgentEventMap {
  [ProcessingEvents.STARTED]: ProcessingStartedData;
  [ProcessingEvents.COMPLETED]: ProcessingCompletedData;
  [ProcessingEvents.ERROR]: ProcessingErrorData;
  [ProcessingEvents.ABORTED]: string; // sessionId
  [ToolExecutionEvents.STARTED]: import('./tool-execution/index.js').ToolExecutionState;
  [ToolExecutionEvents.COMPLETED]: import('./tool-execution/index.js').ToolExecutionState;
  [ToolExecutionEvents.ERROR]: import('./tool-execution/index.js').ToolExecutionState;
  [EnvironmentEvents.STATUS_CHANGED]: EnvironmentStatusData;
  [CheckpointEvents.READY]: CheckpointData;
  [RollbackEvents.COMPLETED]: RollbackData;
  [PermissionEvents.REQUESTED]: PermissionData;
}