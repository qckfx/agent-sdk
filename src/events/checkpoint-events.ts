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
 * Handles both single and multi-repo scenarios
 */
export interface CheckpointPayload {
  sessionId: string;
  toolExecutionId: string;
  hostCommits: Map<string, string>; // repo path -> commit sha
  shadowCommits: Map<string, string>; // repo path -> shadow commit sha
  bundles: Map<string, Uint8Array>; // repo path -> bundle
  repoCount: number;
  timestamp: string;
}

// Event name constant
export const CHECKPOINT_READY_EVENT = 'checkpoint:ready';
