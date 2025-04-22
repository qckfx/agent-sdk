/**
 * CheckpointingExecutionAdapter.ts
 * 
 * Wraps an existing ExecutionAdapter to add checkpointing functionality.
 * Creates checkpoints before state-changing operations (writeFile, editFile, bash).
 */

import { ExecutionAdapter } from '../types/tool.js';
import { SessionState } from '../types/model.js';
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
  private shadowRepoRoot: string;

  constructor(
    private inner: ExecutionAdapter,
    private repoRoot: string,
    private sessionId: string,
    private sessionState: SessionState
  ) {
    this.shadowRepoRoot = `${repoRoot}/.agent-shadow/${sessionId}`;
    
    // Initialize the checkpoint system
    CheckpointManager.init(repoRoot, sessionId, inner);
  }

  /**
   * Take a checkpoint before a state-changing operation
   * @param reason The reason for the checkpoint
   * @returns True if checkpoint was created, false if skipped
   */
  private async cp(reason: string): Promise<boolean> {
    // Get the last message in the context window
    const lastMessage = this.sessionState.contextWindow.peek();
    
    // Skip checkpointing if there's no message to attach to
    if (!lastMessage) {
      console.log(`[CheckpointingExecutionAdapter] Skipping checkpoint: no message in context window`);
      return false;
    }
    
    // Get the host repository commit
    const hostInfo = await this.inner.getGitRepositoryInfo();
    const hostSha = hostInfo?.commitSha ?? 'unknown';
    
    // Prepare metadata
    const meta = {
      sessionId: this.sessionId,
      toolExecutionId: lastMessage.id,
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
  
  async writeFile(filepath: string, content: string, encoding?: string): Promise<void> {
    // First take a checkpoint
    await this.cp('writeFile');
    // Then execute the operation
    return await this.inner.writeFile(filepath, content, encoding);
  }
  
  async editFile(filepath: string, searchCode: string, replaceCode: string, encoding?: string): Promise<FileEditToolResult> {
    // First take a checkpoint
    await this.cp('editFile');
    // Then execute the operation
    return await this.inner.editFile(filepath, searchCode, replaceCode, encoding);
  }
  
  async executeCommand(command: string, workingDir?: string) {
    // First take a checkpoint
    await this.cp('bash');
    // Then execute the operation
    return await this.inner.executeCommand(command, workingDir);
  }
  
  // Read-only operations - direct delegation without checkpointing
  
  async getGitRepositoryInfo(): Promise<GitRepositoryInfo | null> {
    return this.inner.getGitRepositoryInfo();
  }
  
  async glob(pattern: string, options?: any): Promise<string[]> {
    return this.inner.glob(pattern, options);
  }
  
  async readFile(filepath: string, maxSize?: number, lineOffset?: number, lineCount?: number, encoding?: string): Promise<FileReadToolResult> {
    return this.inner.readFile(filepath, maxSize, lineOffset, lineCount, encoding);
  }
  
  async ls(dirPath: string, showHidden?: boolean, details?: boolean): Promise<LSToolResult> {
    return this.inner.ls(dirPath, showHidden, details);
  }
  
  async generateDirectoryMap(rootPath: string, maxDepth?: number): Promise<string> {
    return this.inner.generateDirectoryMap(rootPath, maxDepth);
  }
}