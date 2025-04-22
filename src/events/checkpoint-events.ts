/**
 * checkpoint-events.ts
 * 
 * Event bus for checkpoint-related events.
 */

import { EventEmitter } from 'events';

// Create a new event emitter for checkpoint events
export const CheckpointEvents = new EventEmitter();

/**
 * Payload for checkpoint events
 */
export interface CheckpointPayload {
  sessionId: string;
  toolExecutionId: string;
  hostCommit: string;
  shadowCommit: string;
  bundle: Uint8Array;
}

// Event name constant
export const CHECKPOINT_READY_EVENT = 'checkpoint:ready';