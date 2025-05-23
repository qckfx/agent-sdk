/**
 * RollbackManager.ts
 *
 * Exposes a convenience helper that allows external clients (e.g. the
 * WebSocket service or HTTP API) to request a rollback to a previous
 * checkpoint. If the session currently has work in‑flight we first emit an
 * abort request so that the running operation terminates cleanly before the
 * checkout is performed.
 */

import { SessionState } from '../types/model.js';
import { AgentEvents, AgentEventType, setSessionAborted } from './sessionUtils.js';
import * as CheckpointManager from './CheckpointManager.js';

/**
 * Roll back all repositories to a previous checkpoint for the given session.
 * Handles both single and multi-repo scenarios.
 *
 * @param sessionId   The active session identifier.
 * @param sessionState The session state containing execution adapter.
 * @param messageId   The message ID to rollback to (determines checkpoint).
 *
 * @returns Map of repository paths to commit SHAs that were reset to.
 */
export async function rollbackSession(
  sessionId: string,
  sessionState: SessionState,
  messageId: string,
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

  setSessionAborted(sessionId);

  // --------------------------------------------------------------------
  // 1. Work out which checkpoint (if any) we need to restore.
  // --------------------------------------------------------------------

  const ctx = sessionState.contextWindow;
  let checkpointId: string | undefined;

  const targetMsg = ctx
    ?.getConversationMessages()
    .find((m) => m.id === messageId);

  checkpointId = targetMsg?.lastCheckpointId;

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
      sessionId,
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

  // For backwards compatibility, emit the first repo's commit SHA
  const firstCommitSha = restoredCommits.values().next().value || '';
  
  AgentEvents.emit(AgentEventType.ROLLBACK_COMPLETED, {
    sessionId: sessionState.sessionId,
    commitSha: firstCommitSha,
    restoredCommits, // Add full multi-repo data for new consumers
    repoCount: restoredCommits.size,
  });

  return restoredCommits;
}
