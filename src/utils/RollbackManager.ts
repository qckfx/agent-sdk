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
 * Roll back the repository to a previous checkpoint for the given session.
 *
 * @param sessionId   The active session identifier.
 * @param adapter     Execution adapter used to run git commands.
 * @param repoRoot    Absolute path to the host repository root.
 * @param commitSha   Optional checkpoint commit SHA or ref.  If omitted, the
 *                    latest checkpoint (HEAD) is used.
 *
 * @returns The commit SHA that the repository was reset to.
 */
export async function rollbackSession(
  sessionId: string,
  sessionState: SessionState,
  repoRoot: string,
  messageId: string,
): Promise<string | undefined> {
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
  // 2. Restore the repository state *only* when we have a checkpoint.
  // --------------------------------------------------------------------

  let restoredSha: string | undefined = undefined;

  if (checkpointId) {
    restoredSha = await CheckpointManager.restore(
      sessionId,
      sessionState.executionAdapter,
      repoRoot,
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

  AgentEvents.emit(AgentEventType.ROLLBACK_COMPLETED, {
    sessionId: sessionState.sessionId,
    commitSha: restoredSha ?? '',
  });

  return restoredSha;
}
