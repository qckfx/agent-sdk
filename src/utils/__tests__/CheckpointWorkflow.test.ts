/**
 * Simplified test for the checkpoint workflow
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointingExecutionAdapter } from '../CheckpointingExecutionAdapter.js';
import { ExecutionAdapter } from '../../types/tool.js';
import { SessionState } from '../../types/model.js';
import * as CheckpointManager from '../CheckpointManager.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../../events/checkpoint-events.js';

// Mock the CheckpointManager module
vi.mock('../CheckpointManager.js');

describe('CheckpointWorkflow', () => {
  // Mock file system state
  let fileSystem: Record<string, string> = {};
  
  // Mock execution adapter
  const mockAdapter: Partial<ExecutionAdapter> = {
    executeCommand: vi.fn().mockResolvedValue({
      stdout: 'success',
      stderr: '',
      exitCode: 0
    }),
    
    writeFile: vi.fn().mockImplementation((filepath, content) => {
      fileSystem[filepath] = content;
      return Promise.resolve();
    }),
    
    getGitRepositoryInfo: vi.fn().mockResolvedValue({
      isGitRepository: true,
      currentBranch: 'main',
      commitSha: 'test-commit-sha',
      status: { type: 'clean' }
    })
  };

  // Mock session state with context window
  const mockContextWindow = {
    peek: () => ({ id: 'test-tool-execution-id', createdAt: Date.now(), anthropic: {} })
  };
  
  const mockSessionState = {
    contextWindow: mockContextWindow
  } as unknown as SessionState;

  let adapter: CheckpointingExecutionAdapter;
  
  beforeEach(() => {
    vi.resetAllMocks();
    fileSystem = {};
    
    // Setup default mocks
    vi.mocked(CheckpointManager.init).mockResolvedValue(undefined);
    vi.mocked(CheckpointManager.snapshot).mockResolvedValue({
      sha: 'mock-sha',
      bundle: new Uint8Array([1, 2, 3, 4])
    });
    
    // Create adapter instance
    adapter = new CheckpointingExecutionAdapter(
      mockAdapter as ExecutionAdapter,
      '/repo',
      'test-session',
      mockSessionState
    );
  });

  it('calls snapshot before writeFile', async () => {
    // Set up event listener
    const eventSpy = vi.fn();
    CheckpointEvents.on(CHECKPOINT_READY_EVENT, eventSpy);
    
    // Perform the operation
    await adapter.writeFile('/test/file.txt', 'new content');
    
    // Verify checkpoint was taken before the file was modified
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'writeFile' }),
      expect.anything(),
      '/repo'
    );
    
    // Verify writeFile was called
    expect(mockAdapter.writeFile).toHaveBeenCalledWith(
      '/test/file.txt', 
      'new content',
      undefined
    );
    
    // Verify event was emitted
    expect(eventSpy).toHaveBeenCalledWith(expect.anything());
    
    // Verify call order
    const snapshotCall = vi.mocked(CheckpointManager.snapshot).mock.invocationCallOrder[0];
    const writeFileCall = vi.mocked(mockAdapter.writeFile).mock.invocationCallOrder[0];
    expect(snapshotCall).toBeLessThan(writeFileCall);
    
    // Cleanup
    CheckpointEvents.removeAllListeners(CHECKPOINT_READY_EVENT);
  });

  it('calls snapshot before executeCommand', async () => {
    // Perform the operation
    await adapter.executeCommand('echo test');
    
    // Verify checkpoint was taken before the command was executed
    expect(CheckpointManager.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'bash' }),
      expect.anything(),
      '/repo'
    );
    
    // Verify executeCommand was called
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith('echo test', undefined);
    
    // Verify call order
    const snapshotCall = vi.mocked(CheckpointManager.snapshot).mock.invocationCallOrder[0];
    const executeCommandCall = vi.mocked(mockAdapter.executeCommand).mock.invocationCallOrder[0];
    expect(snapshotCall).toBeLessThan(executeCommandCall);
  });
});