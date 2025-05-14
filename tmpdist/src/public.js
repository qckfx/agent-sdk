/**
 * agent-core public API
 *
 * This file exports the stable, public API surface for agent-core.
 */
// Primary API
export { Agent } from './Agent.js';
export { createAgent } from './core/Agent.js';
export { createTool } from './tools/createTool.js';
export { LLMFactory } from './providers/index.js';
// Event helpers (safe, read‑only API surface)
export { onAbortSession, onEnvironmentStatusChanged, onProcessingCompleted, 
// Checkpoint events
onCheckpointReady, offCheckpointReady, CHECKPOINT_READY_EVENT, CheckpointEvents, 
// Rollback events
onRollbackCompleted, } from './events.js';
// Rollback helper
export { rollbackSession } from './utils/RollbackManager.js';
// Checkpoint system exports
export { CheckpointingExecutionAdapter } from './utils/CheckpointingExecutionAdapter.js';
//# sourceMappingURL=public.js.map