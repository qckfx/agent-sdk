/**
 * CheckpointingExecutionAdapter.ts
 * 
 * Wraps an existing ExecutionAdapter to add checkpointing functionality.
 * Creates checkpoints before state-changing operations (writeFile, editFile, bash).
 */

import { ExecutionAdapter } from '../types/tool.js';
import { GitRepositoryInfo } from '../types/repository.js';
import { FileEditToolResult } from '../tools/FileEditTool.js';
import { FileReadToolResult } from '../tools/FileReadTool.js';
import { LSToolResult } from '../tools/LSTool.js';
import * as CheckpointManager from './CheckpointManager.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT, CheckpointPayload } from '../events/checkpoint-events.js';

/**
 * A wrapper around an ExecutionAdapter that adds checkpointing functionality
 */
export class CheckpointingExecutionAdapter implements ExecutionAdapter {

  constructor(
    private inner: ExecutionAdapter,
    private repoRoot: string,
    private sessionId: string,
  ) {
    // Kick-off initialization **asynchronously** but keep a handle so that we
    // can await it before the first snapshot.  Not awaiting here prevented the
    // shadow repository from being fully set-up when the very first
    // state-changing operation arrived, resulting in "not a git repository"
    // failures inside `CheckpointManager.snapshot()`.
    this._initPromise = CheckpointManager.init(repoRoot, sessionId, inner);
  }

  /**
   * Promise that resolves once the shadow repository is ready.  All
   * checkpoint-taking operations must await this to guarantee that the shadow
   * repo exists before we attempt to commit into it.
   */
  private _initPromise: Promise<void>;

  /**
   * Take a checkpoint before a state-changing operation
   * @param reason The reason for the checkpoint
   * @returns True if checkpoint was created, false if skipped
   */
  private async cp(executionId: string, reason: string): Promise<boolean> {

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
    } as CheckpointPayload);
    
    return true;
  }

  // State-changing operations that trigger checkpoints
  
  async writeFile(executionId: string, filepath: string, content: string, encoding?: string): Promise<void> {
    // First take a checkpoint
    await this.cp(executionId, 'writeFile');
    // Then execute the operation
    return await this.inner.writeFile(executionId, filepath, content, encoding);
  }
  
  async editFile(executionId: string, filepath: string, searchCode: string, replaceCode: string, encoding?: string): Promise<FileEditToolResult> {
    // First take a checkpoint
    await this.cp(executionId, 'editFile');
    // Then execute the operation
    return await this.inner.editFile(executionId, filepath, searchCode, replaceCode, encoding);
  }
  
  async executeCommand(executionId: string, command: string, workingDir?: string) {
    // First take a checkpoint
    await this.cp(executionId, 'bash');
    // Then execute the operation
    return await this.inner.executeCommand(executionId, command, workingDir);
  }
  
  // Read-only operations - direct delegation without checkpointing
  
  async getGitRepositoryInfo(): Promise<GitRepositoryInfo | null> {
    return this.inner.getGitRepositoryInfo();
  }
  
  async glob(executionId: string, pattern: string, options?: any): Promise<string[]> {
    return this.inner.glob(executionId, pattern, options);
  }
  
  async readFile(executionId: string, filepath: string, maxSize?: number, lineOffset?: number, lineCount?: number, encoding?: string): Promise<FileReadToolResult> {
    return this.inner.readFile(executionId, filepath, maxSize, lineOffset, lineCount, encoding);
  }
  
  async ls(executionId: string, dirPath: string, showHidden?: boolean, details?: boolean): Promise<LSToolResult> {
    return this.inner.ls(executionId, dirPath, showHidden, details);
  }
  
  async generateDirectoryMap(rootPath: string, maxDepth?: number): Promise<string> {
    return this.inner.generateDirectoryMap(rootPath, maxDepth);
  }
}