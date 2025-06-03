import type { AgentEventMap } from './events.js';

/**
 * Re-export AgentEventMap under a clearer alias used by the event bus.
 */
export type BusEvents = AgentEventMap;

// Convenience type – union of event names
export type BusEventKey = keyof BusEvents;

export enum BusEvent {
  PROCESSING_STARTED = 'processing:started',
  PROCESSING_COMPLETED = 'processing:completed',
  PROCESSING_ERROR = 'processing:error',
  PROCESSING_ABORTED = 'processing:aborted',
  TOOL_EXECUTION_STARTED = 'tool:execution:started',
  TOOL_EXECUTION_COMPLETED = 'tool:execution:completed',
  TOOL_EXECUTION_ERROR = 'tool:execution:error',
  ENVIRONMENT_STATUS_CHANGED = 'environment:status_changed',
  CHECKPOINT_READY = 'checkpoint:ready',
  ROLLBACK_COMPLETED = 'rollback:completed',
  PERMISSION_REQUESTED = 'permission:requested',
}
