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
  toolExecutionId: string,
): Promise<string> {
  if (!sessionState.executionAdapter) {
    throw new Error('Execution adapter not found');
  }
  // If there is potentially an operation in‑flight we honour the specification
  // by signalling an abort first.  The AbortSignal propagated throughout the
  // agent runtime will attempt to cancel any current model/tool work.
  setSessionAborted(sessionId);

  // Perform the actual restoration.  The shadow repo checkout will overwrite
  // the worktree to match the desired checkpoint state.
  const restoredSha = await CheckpointManager.restore(
    sessionId,
    sessionState.executionAdapter,
    repoRoot,
    toolExecutionId,
  );

  // Update the context window by removing messages up to and including the one we're rolling back to
  if (sessionState.contextWindow) {
    const removedCount = sessionState.contextWindow.rollbackToMessage(toolExecutionId);
    console.log(`Rolled back context window by removing ${removedCount} messages`);
  }

  // Notify listeners that the rollback is complete so that the UI or other
  // services can refresh state (e.g. file trees, diff views, etc.)
  AgentEvents.emit(AgentEventType.ROLLBACK_COMPLETED, {
    sessionId: sessionState.sessionId,
    commitSha: restoredSha,
  });

  return restoredSha;
}
