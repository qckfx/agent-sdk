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
 * A wrapper around an ExecutionAdapter that adds multi-repo checkpointing functionality
 */
export class CheckpointingExecutionAdapter implements ExecutionAdapter {

  constructor(
    private inner: ExecutionAdapter,
    private sessionId: string,
  ) {
    // Kick-off initialization **asynchronously** using the inner adapter's 
    // multi-repo capabilities. This initializes checkpointing for all 
    // repositories found by the inner adapter's MultiRepoManager.
    this._initPromise = this.initializeRepositories();
  }

  /**
   * Promise that resolves once all shadow repositories are ready.  All
   * checkpoint-taking operations must await this to guarantee that the shadow
   * repos exist before we attempt to commit into them.
   */
  private _initPromise: Promise<void>;
  
  /**
   * Initialize checkpointing for all repositories using inner adapter's capabilities
   */
  private async initializeRepositories(): Promise<void> {
    try {
      // Get all repositories from the inner adapter
      const directoryStructures = await this.inner.getDirectoryStructures();
      const repoPaths = Array.from(directoryStructures.keys());
      
      // Initialize checkpointing for each repository
      await CheckpointManager.initMultiRepo(repoPaths, this.sessionId, this.inner);
    } catch (error) {
      console.error('Failed to initialize multi-repo checkpointing:', error);
      throw error;
    }
  }

  /**
   * Take a multi-repo checkpoint before a state-changing operation
   * @param reason The reason for the checkpoint
   * @returns True if checkpoint was created, false if skipped
   */
  private async cp(executionId: string, reason: string): Promise<boolean> {

    // Ensure all shadow repositories have finished initializing.  If
    // initialization failed we'll surface the error here.
    await this._initPromise;

    // Get all repositories and their git information
    const directoryStructures = await this.inner.getDirectoryStructures();
    const repoPaths = Array.from(directoryStructures.keys());
    const gitRepos = await this.inner.getGitRepositoryInfo();
    
    // Build host commits map
    const hostCommits = new Map<string, string>();
    for (const repo of gitRepos) {
      hostCommits.set(repo.repoRoot, repo.commitSha ?? 'unknown');
    }
    
    // Prepare metadata
    const meta: CheckpointManager.SnapshotMeta = {
      sessionId: this.sessionId,
      toolExecutionId: executionId,
      hostCommits,
      reason,
      timestamp: new Date().toISOString()
    };
    
    // Create the multi-repo snapshot
    const result = await CheckpointManager.snapshotMultiRepo(meta, this.inner, repoPaths);
    
    // Build shadow commits and bundles maps for the event
    const shadowCommits = new Map<string, string>();
    const bundles = new Map<string, Uint8Array>();
    
    for (const [repoPath, snapshot] of result.repoSnapshots) {
      shadowCommits.set(repoPath, snapshot.sha);
      bundles.set(repoPath, snapshot.bundle);
    }
    
    // Emit the checkpoint event
    CheckpointEvents.emit(CHECKPOINT_READY_EVENT, {
      sessionId: meta.sessionId,
      toolExecutionId: meta.toolExecutionId,
      hostCommits: meta.hostCommits,
      shadowCommits,
      bundles,
      repoCount: result.aggregateSnapshot.repoCount,
      timestamp: meta.timestamp
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
  
  async getGitRepositoryInfo(): Promise<GitRepositoryInfo[]> {
    return this.inner.getGitRepositoryInfo();
  }
  
  async getDirectoryStructures(): Promise<Map<string, string>> {
    return this.inner.getDirectoryStructures();
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