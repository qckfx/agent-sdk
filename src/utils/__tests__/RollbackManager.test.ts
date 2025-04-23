import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rollbackSession } from '../RollbackManager.js';
import * as CheckpointManager from '../CheckpointManager.js';
import { AgentEvents, AgentEventType, setSessionAborted } from '../sessionUtils.js';
import { ContextWindow } from '../../types/contextWindow.js';
import { SessionState } from '../../types/model.js';

// Mock dependencies
vi.mock('../CheckpointManager.js', () => ({
  restore: vi.fn().mockResolvedValue('mock-commit-sha'),
}));

vi.mock('../sessionUtils.js', () => ({
  AgentEvents: {
    emit: vi.fn(),
  },
  AgentEventType: {
    ROLLBACK_COMPLETED: 'rollback_completed',
  },
  setSessionAborted: vi.fn(),
}));

describe('RollbackManager', () => {
  let mockSessionState: SessionState;
  let mockContextWindow: ContextWindow;
  
  beforeEach(() => {
    // Create a fresh context window for each test
    mockContextWindow = new ContextWindow();
    
    // Add some messages to the context window
    mockContextWindow.pushUser('Hello');
    mockContextWindow.pushAssistant([{ type: 'text', text: 'Hi there' }]);
    const rollbackToId = mockContextWindow.pushUser('How are you?');
    mockContextWindow.pushAssistant([{ type: 'text', text: 'I am doing well' }]);
    
    // Create a mock session state
    mockSessionState = {
      sessionId: 'mock-session-id',
      contextWindow: mockContextWindow,
      executionAdapter: {
        executeCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
      },
      abortController: new AbortController(),
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should roll back the session and update the context window', async () => {
    // Get the ID of the message to roll back to
    const messageToRollbackTo = mockContextWindow.getConversationMessages()[2].id;
    
    // Initial length should be 4
    expect(mockContextWindow.getLength()).toBe(4);
    
    // Call the rollbackSession function
    const result = await rollbackSession(
      'mock-session-id',
      mockSessionState,
      '/mock/repo/root',
      messageToRollbackTo,
    );
    
    // Verify the result
    expect(result).toBe('mock-commit-sha');
    
    // Verify CheckpointManager.restore was called with the correct arguments
    expect(CheckpointManager.restore).toHaveBeenCalledWith(
      'mock-session-id',
      mockSessionState.executionAdapter,
      '/mock/repo/root',
      messageToRollbackTo,
    );
    
    // Verify setSessionAborted was called
    expect(setSessionAborted).toHaveBeenCalledWith('mock-session-id');
    
    // Verify the context window was updated
    expect(mockContextWindow.getLength()).toBe(1);
    
    // Verify AgentEvents.emit was called with the correct arguments
    expect(AgentEvents.emit).toHaveBeenCalledWith(
      AgentEventType.ROLLBACK_COMPLETED,
      {
        sessionId: 'mock-session-id',
        commitSha: 'mock-commit-sha',
      },
    );
  });

  it('should handle missing executionAdapter', async () => {
    // Remove executionAdapter from session state
    const invalidSessionState = { ...mockSessionState, executionAdapter: undefined };
    
    // Expect rollbackSession to throw an error
    await expect(
      rollbackSession('mock-session-id', invalidSessionState, '/mock/repo/root', 'mock-tool-execution-id')
    ).rejects.toThrow('Execution adapter not found');
  });

  it('should handle non-existent message ID gracefully', async () => {
    // Initial length should be 4
    expect(mockContextWindow.getLength()).toBe(4);
    
    // Call rollbackSession with a non-existent message ID
    await rollbackSession(
      'mock-session-id',
      mockSessionState,
      '/mock/repo/root',
      'non-existent-id',
    );
    
    // Context window should still have all 4 messages
    expect(mockContextWindow.getLength()).toBe(4);
    
    // Other operations should still happen
    expect(CheckpointManager.restore).toHaveBeenCalled();
    expect(AgentEvents.emit).toHaveBeenCalled();
  });
});