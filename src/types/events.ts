/**
 * Event types and interfaces for agent events
 * @module Events
 */

/**
 * Union type for all agent events
 * Events follow a namespace:action pattern for clarity
 */
export type AgentEvent =
  // Processing lifecycle events
  | 'processing:started'
  | 'processing:completed'
  | 'processing:error'
  | 'processing:aborted'
  
  // Tool execution events
  | 'tool:execution:started'
  | 'tool:execution:completed'
  | 'tool:execution:error'
  
  // Environment events
  | 'environment:status_changed'
  
  // Checkpoint events
  | 'checkpoint:ready';

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
 * Checkpoint event data
 */
export interface CheckpointData {
  sessionId: string;
  toolExecutionId: string;
  hostCommit: string;
  shadowCommit: string;
  bundle: Uint8Array;
}

/**
 * Map of event names to their data types
 * This allows for type-safe event handling
 */
export interface AgentEventMap {
  'processing:started': ProcessingStartedData;
  'processing:completed': ProcessingCompletedData;
  'processing:error': ProcessingErrorData;
  'processing:aborted': string; // sessionId
  'tool:execution:started': import('./tool-execution/index.js').ToolExecutionState;
  'tool:execution:completed': import('./tool-execution/index.js').ToolExecutionState;
  'tool:execution:error': import('./tool-execution/index.js').ToolExecutionState;
  'environment:status_changed': EnvironmentStatusData;
  'checkpoint:ready': CheckpointData;
}