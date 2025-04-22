/**
 * End-to-end integration test for the checkpoint workflow
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointingExecutionAdapter } from '../CheckpointingExecutionAdapter.js';
import { ExecutionAdapter } from '../../types/tool.js';
import { SessionState } from '../../types/model.js';
import * as CheckpointManager from '../CheckpointManager.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../../events/checkpoint-events.js';

describe('Checkpoint Workflow Integration', () => {
  // We're not going to mock CheckpointManager for this test
  // since we want to test the full workflow

  // Mock file system state
  let fileSystem: Record<string, string> = {};
  
  // Mock execution adapter that tracks actual file content
  const mockInnerAdapter: Partial<ExecutionAdapter> = {
    executeCommand: vi.fn().mockImplementation((cmd) => {
      if (cmd.includes('mktemp')) {
        return Promise.resolve({
          stdout: '/tmp/test-bundle-file',
          stderr: '',
          exitCode: 0
        });
      }
      // All other commands "succeed"
      return Promise.resolve({
        stdout: 'success',
        stderr: '',
        exitCode: 0
      });
    }),
    
    // Track actual file content changes
    writeFile: vi.fn().mockImplementation((filepath, content) => {
      fileSystem[filepath] = content;
      return Promise.resolve();
    }),
    
    // Read actual file content
    readFile: vi.fn().mockImplementation((filepath, maxSize, lineOffset, lineCount, encoding) => {
      if (filepath === '/tmp/test-bundle-file') {
        // Mock a bundle file with base64 encoding
        return Promise.resolve({
          success: true,
          path: filepath,
          content: 'VGVzdEJ1bmRsZQ==', // "TestBundle" in base64
          size: 10,
          encoding: 'base64'
        });
      }
      
      if (fileSystem[filepath]) {
        return Promise.resolve({
          success: true,
          path: filepath,
          content: fileSystem[filepath],
          size: fileSystem[filepath].length,
          encoding: encoding || 'utf8'
        });
      }
      
      return Promise.resolve({
        success: false,
        path: filepath,
        error: 'File not found'
      });
    }),
    
    getGitRepositoryInfo: vi.fn().mockResolvedValue({
      isGitRepository: true,
      currentBranch: 'main',
      defaultBranch: 'main',
      commitSha: 'test-commit-sha',
      status: { type: 'clean' },
      recentCommits: ['test-commit-sha Test commit']
    })
  };

  // Mock session state
  const mockSessionState = {
    currentToolExecutionId: 'test-tool-execution-id',
    generateNewToolExecutionId: () => 'new-tool-id'
  } as unknown as SessionState;

  // Spy on CheckpointManager.snapshot
  const snapshotSpy = vi.spyOn(CheckpointManager, 'snapshot');
  
  let adapter: CheckpointingExecutionAdapter;
  
  beforeEach(() => {
    vi.resetAllMocks();
    fileSystem = {
      '/repo/test-file.txt': 'Initial content'
    };
    
    // Create adapter instance
    adapter = new CheckpointingExecutionAdapter(
      mockInnerAdapter as ExecutionAdapter,
      '/repo',
      'test-session',
      mockSessionState
    );
    
    // Reset the snapshot spy
    snapshotSpy.mockClear();
  });

  it('performs snapshot-before-change for writeFile operations', async () => {
    // Set up event listener to track emissions
    const checkpointEventSpy = vi.fn();
    CheckpointEvents.on(CHECKPOINT_READY_EVENT, checkpointEventSpy);
    
    // Test case: File content before writeFile is preserved in the snapshot
    await adapter.writeFile('/repo/test-file.txt', 'New content');
    
    // Verify checkpoint was taken before the file was modified
    expect(snapshotSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'writeFile',
        hostCommit: 'test-commit-sha',
        sessionId: 'test-session',
        toolExecutionId: 'test-tool-execution-id'
      }),
      mockInnerAdapter,
      '/repo'
    );
    
    // Verify writeFile was called after snapshot
    expect(mockInnerAdapter.writeFile).toHaveBeenCalledWith(
      '/repo/test-file.txt', 
      'New content',
      undefined
    );
    
    // Verify checkpoint event was emitted
    expect(checkpointEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session',
        toolExecutionId: 'test-tool-execution-id',
        hostCommit: 'test-commit-sha'
      })
    );
    
    // Verify current file state
    expect(fileSystem['/repo/test-file.txt']).toBe('New content');
    
    // Cleanup
    CheckpointEvents.removeAllListeners(CHECKPOINT_READY_EVENT);
  });

  it('preserves the original content in snapshots while updating the file', async () => {
    // Set file content to a known value
    fileSystem['/repo/important-file.txt'] = 'Original important content';
    
    // Mock the snapshot function to capture file state at time of call
    let capturedFileContent: string | null = null;
    snapshotSpy.mockImplementation(async (meta, adapter, repoRoot) => {
      // Capture the current file content when the snapshot is taken
      const fileResult = await adapter.readFile('/repo/important-file.txt');
      if (fileResult.success) {
        capturedFileContent = fileResult.content;
      }
      
      return { 
        sha: 'snapshot-sha', 
        bundle: new Uint8Array([1, 2, 3, 4])
      };
    });
    
    // Perform the file modification
    await adapter.writeFile('/repo/important-file.txt', 'Modified content');
    
    // Verify snapshot captured the ORIGINAL content
    expect(capturedFileContent).toBe('Original important content');
    
    // Verify current file has MODIFIED content
    expect(fileSystem['/repo/important-file.txt']).toBe('Modified content');
  });
});