/**
 * checkpoint-events.ts
 *
 * Event bus for checkpoint-related events.
 */
import { EventEmitter } from 'events';
// Create a new event emitter for checkpoint events
export const CheckpointEvents = new EventEmitter();
// Event name constant
export const CHECKPOINT_READY_EVENT = 'checkpoint:ready';
//# sourceMappingURL=checkpoint-events.js.map