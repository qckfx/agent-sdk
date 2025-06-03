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

import type {
  CheckpointPayload} from '../events/checkpoint-events.js';
import {
  CheckpointEvents,
  CHECKPOINT_READY_EVENT
} from '../events/checkpoint-events.js';
import type { SessionState } from '../types/model.js';

const DETACH_KEY = Symbol('checkpointSyncDetach');

/**
 * Attach the checkpoint‑sync listener if it is not already attached.
 * Handles both single and multi-repo scenarios.
 * @param sessionState
 */
export function attachCheckpointSync(sessionState: SessionState): void {
  // If we have already attached a listener for this session, do nothing.
  if ((sessionState as any)[DETACH_KEY]) return;

  const listener = (payload: CheckpointPayload): void => {
    if (payload.sessionId !== sessionState.id) return;
    sessionState.contextWindow.setLastCheckpointId(payload.toolExecutionId);

    // Update multi-repo tracking metadata
    if (payload.repoCount > 0) {
      const hostCommitsRecord: Record<string, string> = {};
      for (const [repoPath, commitSha] of payload.hostCommits) {
        hostCommitsRecord[repoPath] = commitSha;
      }

      sessionState.multiRepoTracking = {
        repoCount: payload.repoCount,
        repoPaths: Array.from(payload.hostCommits.keys()),
        directoryStructureGenerated:
          sessionState.multiRepoTracking?.directoryStructureGenerated ?? false,
        lastCheckpointMetadata: {
          toolExecutionId: payload.toolExecutionId,
          timestamp: payload.timestamp,
          repoCount: payload.repoCount,
          hostCommits: hostCommitsRecord,
        },
      };
    }
  };

  CheckpointEvents.on(CHECKPOINT_READY_EVENT, listener);

  const detach = (): void => {
    CheckpointEvents.off(CHECKPOINT_READY_EVENT, listener);
    delete (sessionState as any)[DETACH_KEY];
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
 * @param sessionState
 */
export function detachCheckpointSync(sessionState: SessionState): void {
  const detach: (() => void) | undefined = (sessionState as any)[DETACH_KEY];
  if (detach) detach();
}
