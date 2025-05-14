/**
 * CheckpointingExecutionAdapter.ts
 *
 * Wraps an existing ExecutionAdapter to add checkpointing functionality.
 * Creates checkpoints before state-changing operations (writeFile, editFile, bash).
 */
import * as CheckpointManager from './CheckpointManager.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../events/checkpoint-events.js';
/**
 * A wrapper around an ExecutionAdapter that adds checkpointing functionality
 */
export class CheckpointingExecutionAdapter {
    constructor(inner, repoRoot, sessionId) {
        this.inner = inner;
        this.repoRoot = repoRoot;
        this.sessionId = sessionId;
        // Kick-off initialization **asynchronously** but keep a handle so that we
        // can await it before the first snapshot.  Not awaiting here prevented the
        // shadow repository from being fully set-up when the very first
        // state-changing operation arrived, resulting in "not a git repository"
        // failures inside `CheckpointManager.snapshot()`.
        this._initPromise = CheckpointManager.init(repoRoot, sessionId, inner);
    }
    /**
     * Take a checkpoint before a state-changing operation
     * @param reason The reason for the checkpoint
     * @returns True if checkpoint was created, false if skipped
     */
    async cp(executionId, reason) {
        // Ensure the shadow repository has finished initializing.  If
        // initialization failed we'll surface the error here.
        await this._initPromise;
        // Get the host repository commit
        const hostInfo = await this.inner.getGitRepositoryInfo();
        const hostSha = hostInfo?.commitSha ?? 'unknown';
        // Prepare metadata
        const meta = {
            sessionId: this.sessionId,
            toolExecutionId: executionId,
            hostCommit: hostSha,
            reason,
            timestamp: new Date().toISOString()
        };
        // Create the snapshot
        const { sha, bundle } = await CheckpointManager.snapshot(meta, this.inner, this.repoRoot);
        // Emit the checkpoint event
        CheckpointEvents.emit(CHECKPOINT_READY_EVENT, {
            sessionId: meta.sessionId,
            toolExecutionId: meta.toolExecutionId,
            hostCommit: meta.hostCommit,
            shadowCommit: sha,
            bundle
        });
        return true;
    }
    // State-changing operations that trigger checkpoints
    async writeFile(executionId, filepath, content, encoding) {
        // First take a checkpoint
        await this.cp(executionId, 'writeFile');
        // Then execute the operation
        return await this.inner.writeFile(executionId, filepath, content, encoding);
    }
    async editFile(executionId, filepath, searchCode, replaceCode, encoding) {
        // First take a checkpoint
        await this.cp(executionId, 'editFile');
        // Then execute the operation
        return await this.inner.editFile(executionId, filepath, searchCode, replaceCode, encoding);
    }
    async executeCommand(executionId, command, workingDir) {
        // First take a checkpoint
        await this.cp(executionId, 'bash');
        // Then execute the operation
        return await this.inner.executeCommand(executionId, command, workingDir);
    }
    // Read-only operations - direct delegation without checkpointing
    async getGitRepositoryInfo() {
        return this.inner.getGitRepositoryInfo();
    }
    async glob(executionId, pattern, options) {
        return this.inner.glob(executionId, pattern, options);
    }
    async readFile(executionId, filepath, maxSize, lineOffset, lineCount, encoding) {
        return this.inner.readFile(executionId, filepath, maxSize, lineOffset, lineCount, encoding);
    }
    async ls(executionId, dirPath, showHidden, details) {
        return this.inner.ls(executionId, dirPath, showHidden, details);
    }
    async generateDirectoryMap(rootPath, maxDepth) {
        return this.inner.generateDirectoryMap(rootPath, maxDepth);
    }
}
//# sourceMappingURL=CheckpointingExecutionAdapter.js.map