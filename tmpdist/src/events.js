/**
 * Shared event definitions and types used across agent-core.
 * This module provides a centralized event system for agent communication.
 *
 * @module Events
 */
import { AgentEventType } from './utils/sessionUtils.js';
export { AgentEventType }; // Export as value for use with EventEmitter
// Checkpoint events
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from './events/checkpoint-events.js';
export { CheckpointEvents, CHECKPOINT_READY_EVENT };
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
export function onAbortSession(listener) {
    AgentEvents.on(AgentEventType.ABORT_SESSION, listener);
}
/**
 * Subscribe to {@link AgentEventType.ENVIRONMENT_STATUS_CHANGED} events.
 *
 * The callback receives an {@link EnvironmentStatusEvent} object describing the
 * current state of the execution environment.
 */
export function onEnvironmentStatusChanged(listener) {
    AgentEvents.on(AgentEventType.ENVIRONMENT_STATUS_CHANGED, listener);
}
/**
 * Subscribe to {@link AgentEventType.PROCESSING_COMPLETED} events.
 *
 * The callback receives an object containing the `sessionId` and the agent's
 * `response` string.
 */
export function onProcessingCompleted(listener) {
    AgentEvents.on(AgentEventType.PROCESSING_COMPLETED, listener);
}
/**
 * Subscribe to rollback completed events.
 *
 * The callback receives an object containing the `sessionId` and the commit
 * SHA that the repository was reset to.
 */
export function onRollbackCompleted(listener) {
    AgentEvents.on(AgentEventType.ROLLBACK_COMPLETED, listener);
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
export function onCheckpointReady(listener) {
    CheckpointEvents.on(CHECKPOINT_READY_EVENT, listener);
}
/**
 * Unsubscribe from checkpoint ready events.
 */
export function offCheckpointReady(listener) {
    CheckpointEvents.off(CHECKPOINT_READY_EVENT, listener);
}
//# sourceMappingURL=events.js.map