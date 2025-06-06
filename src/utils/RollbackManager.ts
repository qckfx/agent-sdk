/**
 * RollbackManager.ts
 *
 * Exposes a convenience helper that allows external clients (e.g. the
 * WebSocket service or HTTP API) to request a rollback to a previous
 * checkpoint. If the session currently has work in‑flight we first emit an
 * abort request so that the running operation terminates cleanly before the
 * checkout is performed.
 */

import type { BusEvents } from '../types/bus-events.js';
import { BusEvent } from '../types/bus-events.js';
import type { SessionState } from '../types/model.js';

import * as CheckpointManager from './CheckpointManager.js';
import { setSessionAborted } from './sessionUtils.js';
import type { TypedEventEmitter } from './TypedEventEmitter.js';

/**
 * Roll back all repositories to a previous checkpoint for the given session.
 * Handles both single and multi-repo scenarios.
 * @param sessionId   The active session identifier.
 * @param sessionState The session state containing execution adapter.
 * @param messageId   The message ID to rollback to (determines checkpoint).
 * @param eventBus
 * @returns Map of repository paths to commit SHAs that were reset to.
 */
export async function rollbackSession(
  sessionState: SessionState,
  messageId: string,
  eventBus: TypedEventEmitter<BusEvents>,
): Promise<Map<string, string>> {
  if (!sessionState.executionAdapter) {
    throw new Error('Execution adapter not found');
  }

  // Always abort any in‑flight operation first – this cooperates with tools
  // that honour the session's AbortSignal.
  // Signal an abort for any operation currently in-flight.
  // NOTE: we set a session-level flag *before* emitting the abort so that
  // the AgentRunner can decide to skip its usual acknowledgement message.
  (sessionState as any).skipAbortAck = true;

  setSessionAborted(sessionState, eventBus);

  // --------------------------------------------------------------------
  // 1. Work out which checkpoint (if any) we need to restore.
  // --------------------------------------------------------------------

  const ctx = sessionState.contextWindow;

  const targetMsg = ctx?.getConversationMessages().find(m => m.id === messageId);

  const checkpointId = targetMsg?.lastCheckpointId;

  // --------------------------------------------------------------------
  // 2. Restore all repository states *only* when we have a checkpoint.
  // --------------------------------------------------------------------

  let restoredCommits = new Map<string, string>();

  if (checkpointId) {
    // Get all repositories from the execution adapter
    const directoryStructures = await sessionState.executionAdapter.getDirectoryStructures();
    const repoPaths = Array.from(directoryStructures.keys());

    // Restore all repositories to the checkpoint
    restoredCommits = await CheckpointManager.restoreMultiRepo(
      sessionState.id,
      sessionState.executionAdapter,
      repoPaths,
      checkpointId,
    );
  }

  // --------------------------------------------------------------------
  // 3. Trim the context window so it matches the requested timeline.
  // --------------------------------------------------------------------

  if (ctx) {
    const removedCount = ctx.rollbackToMessage(messageId);
    console.log(`Rolled back context window by removing ${removedCount} messages`);
  }

  // --------------------------------------------------------------------
  // 4. Notify listeners so that UIs can refresh.
  // --------------------------------------------------------------------

  // Update multi-repo tracking with rollback information
  if (restoredCommits.size > 0 && checkpointId) {
    const hostCommitsRecord: Record<string, string> = {};
    for (const [repoPath, commitSha] of restoredCommits) {
      hostCommitsRecord[repoPath] = commitSha;
    }

    if (sessionState.multiRepoTracking) {
      sessionState.multiRepoTracking.lastCheckpointMetadata = {
        toolExecutionId: checkpointId,
        timestamp: new Date().toISOString(),
        repoCount: restoredCommits.size,
        hostCommits: hostCommitsRecord,
      };
    }
  }

  // For backwards compatibility, emit the first repo's commit SHA
  const firstCommitSha = restoredCommits.values().next().value || '';

  eventBus.emit(BusEvent.ROLLBACK_COMPLETED, {
    sessionId: sessionState.id,
    commitSha: firstCommitSha,
    restoredCommits,
    repoCount: restoredCommits.size,
  });

  return restoredCommits;
}
