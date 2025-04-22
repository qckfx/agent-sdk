/**
 * Shared event definitions and types used across agent-core.
 * This module provides a centralized event system for agent communication.
 * 
 * @module Events
 */

/**
 * Event emitted when a new message is added to the conversation
 * 
 * @event
 * @type {object} data
 * @property {string} sessionId - The session ID
 * @property {object} message - The message object that was added
 */
export const MESSAGE_ADDED = 'message:added';
import { MessageAddedEvent } from './types/message.js';
export { MessageAddedEvent };

/**
 * Event emitted when an existing message is updated
 * 
 * @event
 * @type {object} data
 * @property {string} sessionId - The session ID
 * @property {object} message - The updated message object
 * @property {string} message.id - The ID of the message that was updated
 */
export const MESSAGE_UPDATED = 'message:updated';
import { MessageUpdatedEvent } from './types/message.js';
export { MessageUpdatedEvent };


import { AgentEventType } from './utils/sessionUtils.js';
export { AgentEventType }; // Export as value for use with EventEmitter
export type { EnvironmentStatusEvent } from './utils/sessionUtils.js';

// Checkpoint events
import { CheckpointEvents, CHECKPOINT_READY_EVENT, CheckpointPayload } from './events/checkpoint-events.js';
export { CheckpointEvents, CHECKPOINT_READY_EVENT };
export type { CheckpointPayload };

// ---------------------------------------------------------------------------
// Public helper subscription functions
// ---------------------------------------------------------------------------

// NOTE: We purposefully do NOT export the internal EventEmitter instance.  The
// helper functions below provide a limited, typed surface for consumers to
// subscribe to agent‑level events without being able to emit events or remove
// internal listeners.

import { AgentEvents } from './utils/sessionUtils.js';

/**
 * Subscribe to the {@link AgentEventType.ABORT_SESSION} event.
 *
 * This event is emitted whenever a session is manually aborted by the user or
 * system. The listener is called with the aborted session's ID.
 */
export function onAbortSession(listener: (sessionId: string) => void): void {
  AgentEvents.on(AgentEventType.ABORT_SESSION, listener);
}

import { EnvironmentStatusEvent } from './utils/sessionUtils.js';
/**
 * Subscribe to {@link AgentEventType.ENVIRONMENT_STATUS_CHANGED} events.
 *
 * The callback receives an {@link EnvironmentStatusEvent} object describing the
 * current state of the execution environment.
 */
export function onEnvironmentStatusChanged(
  listener: (event: EnvironmentStatusEvent) => void
): void {
  AgentEvents.on(AgentEventType.ENVIRONMENT_STATUS_CHANGED, listener);
}

/**
 * Subscribe to {@link AgentEventType.PROCESSING_COMPLETED} events.
 *
 * The callback receives an object containing the `sessionId` and the agent's
 * `response` string.
 */
export function onProcessingCompleted(
  listener: (data: { sessionId: string; response: string }) => void
): void {
  AgentEvents.on(AgentEventType.PROCESSING_COMPLETED, listener);
}

/**
 * Subscribe to message‑stream events emitted whenever a new message is added
 * to the session history.
 *
 * The callback is invoked with an object containing the `sessionId` and the
 * complete `message` that was pushed.
 */
export function onMessageAdded(
  listener: (data: MessageAddedEvent) => void
): void {
  AgentEvents.on(MESSAGE_ADDED, listener);
}

/**
 * Unsubscribe from message‑stream events emitted whenever a new message is added.
 */
export function offMessageAdded(
  listener: (data: MessageAddedEvent) => void
): void {
  AgentEvents.off(MESSAGE_ADDED, listener);
}

/**
 * Subscribe to events emitted whenever an existing message is updated.
 *
 * The callback receives the `sessionId` and the updated `message` object.
 */
export function onMessageUpdated(
  listener: (data: MessageUpdatedEvent) => void
): void {
  AgentEvents.on(MESSAGE_UPDATED, listener);
}

/**
 * Unsubscribe from message‑stream events emitted whenever a new message is added.
 */
export function offMessageUpdated(
  listener: (data: MessageUpdatedEvent) => void
): void {
  AgentEvents.off(MESSAGE_UPDATED, listener);
}

/**
 * Subscribe to checkpoint ready events emitted whenever a state-changing
 * operation creates a new checkpoint.
 * 
 * The callback receives a CheckpointPayload object containing:
 * - sessionId: The session ID
 * - toolExecutionId: The ID of the tool execution that triggered the checkpoint
 * - hostCommit: The current commit of the host repository
 * - shadowCommit: The new shadow commit SHA
 * - bundle: The git bundle as a Uint8Array
 */
export function onCheckpointReady(
  listener: (data: CheckpointPayload) => void
): void {
  CheckpointEvents.on(CHECKPOINT_READY_EVENT, listener);
}

/**
 * Unsubscribe from checkpoint ready events.
 */
export function offCheckpointReady(
  listener: (data: CheckpointPayload) => void
): void {
  CheckpointEvents.off(CHECKPOINT_READY_EVENT, listener);
}