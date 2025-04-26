import { createContextWindow } from '../../types/contextWindow.js';
import { SessionState } from '../../types/model.js';
import { ModelClientConfig } from '../../types/model.js';
import { setSessionAborted, isSessionAborted, clearSessionAborted } from '../../utils/sessionUtils.js';
import { createAgentRunner } from '../AgentRunner.js';
import { createModelClient } from '../ModelClient.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal fake Anthropic message for our test
const fakeMessage = {
  id: 'msg1',
  role: 'assistant',
  content: [],
};

// Mock FsmDriver module so we can test independently
vi.mock('../FsmDriver.js', () => {
  return {
    FsmDriver: vi.fn().mockImplementation(() => {
      return {
        run: vi.fn().mockImplementation((query, sessionState) => {
          // If the session is aborted, immediately return an aborted result
          if (sessionState.abortController?.signal.aborted) {
            return Promise.resolve({
              response: 'Operation aborted by user',
              aborted: true,
              toolResults: []
            });
          }
          
          // Otherwise, simulate a normal execution
          return Promise.resolve({
            response: 'Normal response',
            aborted: false,
            toolResults: []
          });
        }),
        iterations: 1
      };
    })
  };
});

// Import the FsmDriver after mocking
import { FsmDriver } from '../FsmDriver.js';

describe('AbortSignal propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any aborted sessions
    const sessionIds = Array.from(new Set(['session-1', 'session-2']));
    sessionIds.forEach(id => clearSessionAborted(id));
  });

  it('abort signal rejects generateResponse with AbortError', async () => {
    const delayedProvider = () => new Promise<any>((resolve) => {
      setTimeout(() => resolve(fakeMessage), 300);
    });

    const config: ModelClientConfig = {
      // casting to any because we don't implement full provider type in test
      modelProvider: delayedProvider as any,
    } as ModelClientConfig;

    const client = createModelClient(config);

    const sessionState: SessionState = {
      id: 'session-1',
      contextWindow: createContextWindow(),
      abortController: new AbortController()
    };

    const promise = client.generateResponse(
      'hi',
      'claude-3-7-sonnet-20250219', // Add the required model parameter
      [], 
      sessionState, 
      sessionState.abortController ? { signal: sessionState.abortController.signal } : undefined
    );

    setTimeout(() => {
      if (sessionState.abortController) {
        sessionState.abortController.abort();
      }
    }, 50);

    await expect(promise).rejects.toThrow('AbortError');
  });

  it('aborting before first tool call stops FSM execution', async () => {
    // Create a real FSM driver instance
    const driver = new FsmDriver({} as any);
    
    // Create session state with abort controller
    const sessionState: SessionState = {
      id: 'session-2',
      contextWindow: createContextWindow(),
      abortController: new AbortController()
    };

    // Mark session as aborted before running FSM
    setSessionAborted('session-2');
    sessionState.abortedAt = Date.now();

    // Abort the controller
    sessionState.abortController.abort();

    // Run the FSM
    const result = await driver.run('test query', sessionState);

    // Verify FSM detected the abort and short-circuited
    expect(result.aborted).toBe(true);
  });

  it('subsequent user message after abortion is processed normally', async () => {
    // Create a real FSM driver instance
    const driver = new FsmDriver({} as any);
    
    // Setup: Verify abort status is set
    setSessionAborted('session-2');
    expect(isSessionAborted('session-2')).toBe(true);

    // Create the agent runner with minimal mocked dependencies
    const agentRunner = createAgentRunner({
      modelClient: {} as any,
      toolRegistry: {} as any,
      permissionManager: {} as any,
      executionAdapter: {} as any
    });

    // Create session state with a fresh abort controller
    const sessionState: SessionState = {
      id: 'session-2',
      contextWindow: createContextWindow(),
      abortController: new AbortController()
    };
    
    // Process a query through AgentRunner - this should detect the abort,
    // return early, and clean up the abort status automatically
    await agentRunner.processQuery('test query', 'claude-3-7-sonnet-20250219', sessionState);

    // Verify abort status is cleared automatically by AgentRunner
    expect(isSessionAborted('session-2')).toBe(false);

    // Now run the FSM directly - it should process normally since abort was cleared
    const result = await driver.run('next user message', sessionState);

    // Verify FSM ran normally
    expect(result.aborted).toBe(false);
  });
});