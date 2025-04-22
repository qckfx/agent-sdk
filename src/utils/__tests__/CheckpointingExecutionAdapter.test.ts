/**
 * Unit tests for CheckpointingExecutionAdapter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointingExecutionAdapter } from '../CheckpointingExecutionAdapter.js';
import { ExecutionAdapter } from '../../types/tool.js';
import { SessionState } from '../../types/model.js';
import * as CheckpointManager from '../CheckpointManager.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../../events/checkpoint-events.js';

// Mock CheckpointManager module
vi.mock('../CheckpointManager.js', () => ({
  init: vi.fn(),
  snapshot: vi.fn().mockResolvedValue({
    sha: 'abc1234',
    bundle: new Uint8Array([1, 2, 3, 4])
  })
}));

describe('CheckpointingExecutionAdapter', () => {
  // Mock inner execution adapter
  const mockInnerAdapter: Partial<ExecutionAdapter> = {
    executeCommand: vi.fn().mockResolvedValue({
      stdout: 'output',
      stderr: '',
      exitCode: 0
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    editFile: vi.fn().mockResolvedValue({
      success: true,
      path: '/path/to/file',
      originalContent: 'old',
      newContent: 'new'
    }),
    getGitRepositoryInfo: vi.fn().mockResolvedValue({
      isGitRepository: true,
      currentBranch: 'main',
      defaultBranch: 'main',
      commitSha: 'host-sha-123',
      status: { type: 'clean' },
      recentCommits: ['abc1234 Test commit']
    })
  };

  // Mock session state
  const mockSessionState = {
    currentToolExecutionId: 'tool-123',
    generateNewToolExecutionId: vi.fn().mockReturnValue('new-tool-id')
  } as unknown as SessionState;

  let adapter: CheckpointingExecutionAdapter;

  beforeEach(() => {
    vi.resetAllMocks();
    
    // Create adapter instance
    adapter = new CheckpointingExecutionAdapter(
      mockInnerAdapter as ExecutionAdapter,
      '/repo',
      'test-session',
      mockSessionState
    );
  });

  it('initializes the checkpoint system on creation', () => {
    expect(CheckpointManager.init).toHaveBeenCalledWith(
      '/repo',
      'test-session',
      mockInnerAdapter
    );
  });

  it('creates checkpoints before writeFile operations', async () => {
    // Set up execution order tracking
    const executionOrder: string[] = [];
    
    // Override the mock implementations to track execution order
    (CheckpointManager.snapshot as any).mockImplementation(() => {
      executionOrder.push('snapshot');
      return Promise.resolve({
        sha: 'abc1234',
        bundle: new Uint8Array([1, 2, 3, 4])
      });
    });
    
    (mockInnerAdapter.writeFile as any).mockImplementation(() => {
      executionOrder.push('writeFile');
      return Promise.resolve(undefined);
    });
    
    // Set up event listener
    const eventSpy = vi.fn();
    CheckpointEvents.on(CHECKPOINT_READY_EVENT, eventSpy);
    
    // Execute the operation
    await adapter.writeFile('/path/to/file', 'content');
    
    // Verify inner adapter was called
    expect(mockInnerAdapter.writeFile).toHaveBeenCalledWith('/path/to/file', 'content');
    
    // Verify checkpoint was created with the correct commit SHA
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session',
        toolExecutionId: 'tool-123',
        hostCommit: 'host-sha-123',
        reason: 'writeFile'
      }),
      mockInnerAdapter,
      '/repo'
    );
    
    // Verify event was emitted with correct commit SHA
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session',
        toolExecutionId: 'tool-123',
        hostCommit: 'host-sha-123',
        shadowCommit: 'abc1234'
      })
    );
    
    // Verify execution order - snapshot must happen before writeFile
    expect(executionOrder).toEqual(['snapshot', 'writeFile']);
    
    // Clean up
    CheckpointEvents.removeAllListeners(CHECKPOINT_READY_EVENT);
  });

  it('creates checkpoints before editFile operations', async () => {
    // Set up execution order tracking
    const executionOrder: string[] = [];
    
    // Override the mock implementations to track execution order
    (CheckpointManager.snapshot as any).mockImplementation(() => {
      executionOrder.push('snapshot');
      return Promise.resolve({
        sha: 'abc1234',
        bundle: new Uint8Array([1, 2, 3, 4])
      });
    });
    
    (mockInnerAdapter.editFile as any).mockImplementation(() => {
      executionOrder.push('editFile');
      return Promise.resolve({
        success: true,
        path: '/path/to/file',
        originalContent: 'old',
        newContent: 'new'
      });
    });
    
    // Execute the operation
    await adapter.editFile('/path/to/file', 'old', 'new');
    
    // Verify execution order - snapshot must happen before editFile
    expect(executionOrder).toEqual(['snapshot', 'editFile']);
    
    expect(mockInnerAdapter.editFile).toHaveBeenCalledWith('/path/to/file', 'old', 'new', undefined);
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'editFile'
      }),
      mockInnerAdapter,
      '/repo'
    );
  });

  it('creates checkpoints before executeCommand operations', async () => {
    // Set up execution order tracking
    const executionOrder: string[] = [];
    
    // Override the mock implementations to track execution order
    (CheckpointManager.snapshot as any).mockImplementation(() => {
      executionOrder.push('snapshot');
      return Promise.resolve({
        sha: 'abc1234',
        bundle: new Uint8Array([1, 2, 3, 4])
      });
    });
    
    (mockInnerAdapter.executeCommand as any).mockImplementation(() => {
      executionOrder.push('executeCommand');
      return Promise.resolve({
        stdout: 'output',
        stderr: '',
        exitCode: 0
      });
    });
    
    // Execute the operation
    await adapter.executeCommand('echo "test"');
    
    // Verify execution order - snapshot must happen before executeCommand
    expect(executionOrder).toEqual(['snapshot', 'executeCommand']);
    
    expect(mockInnerAdapter.executeCommand).toHaveBeenCalledWith('echo "test"', undefined);
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'bash'
      }),
      mockInnerAdapter,
      '/repo'
    );
  });

  it('passes through read-only operations without creating checkpoints', async () => {
    // Mock read-only methods
    mockInnerAdapter.readFile = vi.fn().mockResolvedValue({ success: true, content: 'content' });
    mockInnerAdapter.glob = vi.fn().mockResolvedValue(['file1', 'file2']);
    mockInnerAdapter.ls = vi.fn().mockResolvedValue({ success: true, entries: [] });
    mockInnerAdapter.generateDirectoryMap = vi.fn().mockResolvedValue('directory map');
    
    // Reset the snapshot mock
    (CheckpointManager.snapshot as any).mockClear();
    
    // Call methods
    await adapter.readFile('/path/to/file');
    await adapter.glob('**/*.js');
    await adapter.ls('/path');
    await adapter.getGitRepositoryInfo();
    await adapter.generateDirectoryMap('/path');
    
    // Verify inner methods were called
    expect(mockInnerAdapter.readFile).toHaveBeenCalled();
    expect(mockInnerAdapter.glob).toHaveBeenCalled();
    expect(mockInnerAdapter.ls).toHaveBeenCalled();
    expect(mockInnerAdapter.getGitRepositoryInfo).toHaveBeenCalled();
    expect(mockInnerAdapter.generateDirectoryMap).toHaveBeenCalled();
    
    // Verify checkpoint was NOT created (except for initialization)
    expect(CheckpointManager.snapshot).not.toHaveBeenCalled();
  });

  it('verifies snapshot-before-change preserves original file content', async () => {
    // This test simulates a writeFile operation and verifies the checkpoint 
    // is taken before the file is modified
    
    // Setup mocks for a file that gets modified
    const originalFileContent = 'original content';
    const newFileContent = 'new content';
    let currentFileContent = originalFileContent;
    
    // Mock file content getter
    const getFileContent = () => currentFileContent;
    
    // Implement mock snapshot that captures current file state
    let capturedFileContent: string | null = null;
    (CheckpointManager.snapshot as any).mockImplementation(() => {
      capturedFileContent = getFileContent();
      return Promise.resolve({
        sha: 'abc1234',
        bundle: new Uint8Array([1, 2, 3, 4])
      });
    });
    
    // Implement writeFile that changes the file
    (mockInnerAdapter.writeFile as any).mockImplementation(() => {
      currentFileContent = newFileContent;
      return Promise.resolve(undefined);
    });
    
    // Perform the write operation
    await adapter.writeFile('/path/to/file', newFileContent);
    
    // Verify snapshot captured the original content before the change
    expect(capturedFileContent).toBe(originalFileContent);
    
    // Verify current content is the new content
    expect(currentFileContent).toBe(newFileContent);
    
    // Verify calls were made in the correct order
    expect(CheckpointManager.snapshot).toHaveBeenCalledBefore(mockInnerAdapter.writeFile as any);
  });
});