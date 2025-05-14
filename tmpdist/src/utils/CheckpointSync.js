/**
 * CheckpointSync – keeps a SessionState's ContextWindow in sync with the
 * latest checkpoint created during tool execution.  The shadow‑git
 * checkpoint system emits a global `checkpoint:ready` event each time a
 * state‑changing tool completes.  This helper attaches a listener for the
 * given session such that every new ConversationMessage records the
 * `toolExecutionId` of the most recent checkpoint.
 *
 * Usage:
 *   attachCheckpointSync(sessionState); // safe to call repeatedly
 *
 * The first call installs the listener and stores a *detach* function on the
 * SessionState under a non‑enumerable property.  Subsequent calls are
 * ignored.  When the session ends, callers may invoke
 * `detachCheckpointSync(sessionState)` to remove the listener and free the
 * closure.
 */
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../events/checkpoint-events.js';
const DETACH_KEY = Symbol('checkpointSyncDetach');
/**
 * Attach the checkpoint‑sync listener if it is not already attached.
 */
export function attachCheckpointSync(sessionState) {
    // If we have already attached a listener for this session, do nothing.
    if (sessionState[DETACH_KEY])
        return;
    const listener = (payload) => {
        if (payload.sessionId !== sessionState.id)
            return;
        sessionState.contextWindow.setLastCheckpointId(payload.toolExecutionId);
    };
    CheckpointEvents.on(CHECKPOINT_READY_EVENT, listener);
    const detach = () => {
        CheckpointEvents.off(CHECKPOINT_READY_EVENT, listener);
        delete sessionState[DETACH_KEY];
    };
    Object.defineProperty(sessionState, DETACH_KEY, {
        value: detach,
        enumerable: false,
        configurable: true,
        writable: false,
    });
    // Initialise with current checkpoint (if any) so the next message inherits
    // the correct value.
    sessionState.contextWindow.setLastCheckpointId(sessionState.contextWindow.getLastCheckpointId());
}
/**
 * Detach the checkpoint‑sync listener for the given session (if attached).
 */
export function detachCheckpointSync(sessionState) {
    const detach = sessionState[DETACH_KEY];
    if (detach)
        detach();
}
//# sourceMappingURL=CheckpointSync.js.map