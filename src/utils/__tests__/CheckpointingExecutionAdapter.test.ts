/**
 * Simplified unit tests for CheckpointingExecutionAdapter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointingExecutionAdapter } from '../CheckpointingExecutionAdapter.js';
import { ExecutionAdapter } from '../../types/tool.js';
import { SessionState } from '../../types/model.js';
import * as CheckpointManager from '../CheckpointManager.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../../events/checkpoint-events.js';

// Mock CheckpointManager module
vi.mock('../CheckpointManager.js');

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
      commitSha: 'test-sha',
      status: { type: 'clean' }
    }),
    readFile: vi.fn().mockResolvedValue({ 
      success: true, 
      content: 'test content' 
    }),
    glob: vi.fn().mockResolvedValue(['file1', 'file2']),
    ls: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    generateDirectoryMap: vi.fn().mockResolvedValue('directory map')
  };

  // Mock session state with context window
  const mockContextWindow = {
    peek: () => ({ id: 'tool-123', createdAt: Date.now(), anthropic: {} })
  };
  
  const mockSessionState = {
    contextWindow: mockContextWindow
  } as unknown as SessionState;

  let adapter: CheckpointingExecutionAdapter;

  beforeEach(() => {
    vi.resetAllMocks();
    
    // Setup default mocks
    vi.mocked(CheckpointManager.init).mockResolvedValue(undefined);
    vi.mocked(CheckpointManager.snapshot).mockResolvedValue({
      sha: 'test-sha',
      bundle: new Uint8Array([1, 2, 3, 4])
    });
    
    // Create adapter instance
    adapter = new CheckpointingExecutionAdapter(
      mockInnerAdapter as ExecutionAdapter,
      '/repo',
      'test-session',
      mockSessionState
    );
  });

  it('initializes checkpoint system on creation', () => {
    expect(CheckpointManager.init).toHaveBeenCalledWith(
      '/repo',
      'test-session',
      mockInnerAdapter
    );
  });

  it('takes checkpoints before state-changing operations', async () => {
    // Test writeFile
    await adapter.writeFile('/test.txt', 'content');
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'writeFile' }),
      expect.anything(),
      '/repo'
    );
    expect(mockInnerAdapter.writeFile).toHaveBeenCalled();
    
    vi.mocked(CheckpointManager.snapshot).mockClear();
    
    // Test editFile
    await adapter.editFile('/test.txt', 'old', 'new');
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'editFile' }),
      expect.anything(),
      '/repo'
    );
    expect(mockInnerAdapter.editFile).toHaveBeenCalled();
    
    vi.mocked(CheckpointManager.snapshot).mockClear();
    
    // Test executeCommand
    await adapter.executeCommand('echo test');
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'bash' }),
      expect.anything(),
      '/repo'
    );
    expect(mockInnerAdapter.executeCommand).toHaveBeenCalled();
  });
  
  it('doesnt take checkpoints for read-only operations', async () => {
    vi.mocked(CheckpointManager.snapshot).mockClear();
    
    // Call read-only methods
    await adapter.readFile('/test.txt');
    await adapter.glob('**/*.js');
    await adapter.ls('/path');
    await adapter.getGitRepositoryInfo();
    await adapter.generateDirectoryMap('/path');
    
    // Verify all inner methods were called
    expect(mockInnerAdapter.readFile).toHaveBeenCalled();
    expect(mockInnerAdapter.glob).toHaveBeenCalled();
    expect(mockInnerAdapter.ls).toHaveBeenCalled();
    expect(mockInnerAdapter.getGitRepositoryInfo).toHaveBeenCalled();
    expect(mockInnerAdapter.generateDirectoryMap).toHaveBeenCalled();
    
    // Verify no checkpoints were created
    expect(CheckpointManager.snapshot).not.toHaveBeenCalled();
  });

  it('emits events when checkpoints are taken', async () => {
    // Set up event listener
    const eventSpy = vi.fn();
    CheckpointEvents.on(CHECKPOINT_READY_EVENT, eventSpy);
    
    // Execute operation
    await adapter.writeFile('/test.txt', 'content');
    
    // Verify event was emitted
    expect(eventSpy).toHaveBeenCalled();
    expect(eventSpy.mock.calls[0][0]).toMatchObject({
      sessionId: 'test-session',
      toolExecutionId: 'tool-123',
      shadowCommit: 'test-sha'
    });
    
    // Verify bundle is present
    expect(eventSpy.mock.calls[0][0].bundle).toBeInstanceOf(Uint8Array);
    
    // Cleanup
    CheckpointEvents.removeAllListeners(CHECKPOINT_READY_EVENT);
  });
  
  it('preserves execution order for state-changing operations', async () => {
    // Set up execution tracking
    const executionOrder: string[] = [];
    
    // Override mocks to track execution order
    vi.mocked(CheckpointManager.snapshot).mockImplementation(() => {
      executionOrder.push('snapshot');
      return Promise.resolve({
        sha: 'test-sha',
        bundle: new Uint8Array([1, 2, 3, 4])
      });
    });
    
    vi.mocked(mockInnerAdapter.writeFile).mockImplementation(() => {
      executionOrder.push('writeFile');
      return Promise.resolve();
    });
    
    // Execute operation
    await adapter.writeFile('/test.txt', 'content');
    
    // Verify correct order
    expect(executionOrder).toEqual(['snapshot', 'writeFile']);
  });
});