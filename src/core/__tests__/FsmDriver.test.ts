import {
  fakeModelClient,
  stubToolRegistry,
  stubLogger,
  stubPermissionManager,
  stubExecutionAdapter,
} from './fsm-helpers.js';
import { FsmDriver } from '../FsmDriver.js';
import { isTerminal } from '../AgentFSM.js';
import { createContextWindow } from '../../types/contextWindow.js';
import { SessionState } from '../../types/model.js';

describe('FsmDriver', () => {
  // Test 1: No-tool happy path
  test('completes with a final assistant reply and no tool calls', async () => {
    // Arrange
    const modelClient = fakeModelClient({ chooseTool: false });
    const { registry, calls } = stubToolRegistry();
    const sessionState: SessionState = {
      contextWindow: createContextWindow(),
      id: 'test-session',
      abortController: new AbortController(),
    };
    const beforeLength = sessionState.contextWindow.getLength();

    // Create a driver
    const driver = new FsmDriver({
      modelClient,
      toolRegistry: registry,
      permissionManager: stubPermissionManager(),
      executionAdapter: stubExecutionAdapter(),
      logger: stubLogger(),
    });

    // Act
    const result = await driver.run('What time is it?', sessionState);

    // Assert
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.response).toBe('done');
    expect(result.aborted).toBe(false);

    // Check state of driver
    expect(isTerminal(driver['state'])).toBe(true);
    expect(driver['state'].type).toBe('COMPLETE');

    // Check conversation history
    expect(sessionState.contextWindow.getLength()).toBe(beforeLength + 2);
    const messages = sessionState.contextWindow.getMessages();
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe('assistant');

    // Check no tool calls were made
    expect(calls.length).toBe(0);
  });

  // Test 2: Single tool path
  test('handles model → tool_use → tool_result → second model → final reply', async () => {
    // Arrange
    const modelClient = fakeModelClient({ chooseTool: true, secondChooseTool: false });
    const { registry, calls } = stubToolRegistry();
    const sessionState: SessionState = {
      contextWindow: createContextWindow(),
      id: 'test-session',
      abortController: new AbortController(),
    };
    const beforeLength = sessionState.contextWindow.getLength();

    // Create a driver
    const driver = new FsmDriver({
      modelClient,
      toolRegistry: registry,
      permissionManager: stubPermissionManager(),
      executionAdapter: stubExecutionAdapter(),
      logger: stubLogger(),
    });

    // Act
    const result = await driver.run('search', sessionState);

    // Assert
    expect(result.response).toBe('done');
    expect(result.aborted).toBe(false);

    // Check toolRegistry for calls
    expect(calls.length).toBe(1);
    expect(calls[0].toolId).toBe('grep');

    // Check conversation history pattern
    const messages = sessionState.contextWindow.getMessages();
    expect(messages.length).toBe(beforeLength + 4);

    // Check message pattern
    // N: assistant tool_use (id:t1)
    const toolUseMessage = messages[beforeLength + 1];
    expect(toolUseMessage.role).toBe('assistant');
    expect(
      toolUseMessage.content[0] &&
        typeof toolUseMessage.content[0] === 'object' &&
        'type' in toolUseMessage.content[0],
    ).toBeTruthy();
    expect((toolUseMessage.content[0] as any).type).toBe('tool_use');
    expect((toolUseMessage.content[0] as any).id).toBe('t1');

    // N+1: user tool_result (tool_use_id:t1)
    const toolResultMessage = messages[beforeLength + 2];
    expect(toolResultMessage.role).toBe('user');
    expect(
      toolResultMessage.content[0] &&
        typeof toolResultMessage.content[0] === 'object' &&
        'type' in toolResultMessage.content[0],
    ).toBeTruthy();
    expect((toolResultMessage.content[0] as any).type).toBe('tool_result');
    expect((toolResultMessage.content[0] as any).tool_use_id).toBe('t1');

    // N+2: assistant text
    const assistantMessage = messages[beforeLength + 3];
    expect(assistantMessage.role).toBe('assistant');
    expect(
      assistantMessage.content[0] &&
        typeof assistantMessage.content[0] === 'object' &&
        'type' in assistantMessage.content[0],
    ).toBeTruthy();
    expect((assistantMessage.content[0] as any).type).toBe('text');

    // Check driver state
    expect(driver['state'].type).toBe('COMPLETE');
  });

  // Test 3: Abort during tool execution
  test('aborts during tool execution and produces the correct state', async () => {
    // Arrange
    const modelClient = fakeModelClient({ chooseTool: true });
    // Tool registry that never resolves promises during execution
    const { registry, calls } = stubToolRegistry('never-resolves');

    const sessionState: SessionState = {
      contextWindow: createContextWindow(),
      id: 'test-session',
      abortController: new AbortController(),
    };
    const beforeLength = sessionState.contextWindow.getLength();

    // Create a driver
    const driver = new FsmDriver({
      modelClient,
      toolRegistry: registry,
      permissionManager: stubPermissionManager(),
      executionAdapter: stubExecutionAdapter(),
      logger: stubLogger(),
    });

    // Set up a promise that aborts after a short delay
    setTimeout(() => {
      if (sessionState.abortController) {
        sessionState.abortController.abort();
      }
    }, 30);

    // Act
    const promise = driver.run('search', sessionState);
    const result = await promise;

    // Assert
    expect(result.aborted).toBe(true);
    expect(result.response).toBe('Operation aborted by user');

    // Check driver state
    expect(driver['state'].type).toBe('ABORTED');

    // Check conversation history ends with a tool_result with aborted:true
    const messages = sessionState.contextWindow.getMessages();
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(
      lastMessage.content[0] &&
        typeof lastMessage.content[0] === 'object' &&
        'type' in lastMessage.content[0],
    ).toBeTruthy();
    expect((lastMessage.content[0] as any).type).toBe('tool_result');

    // Parse the content to check for aborted:true
    const contentObj = JSON.parse((lastMessage.content[0] as any).content);
    expect(contentObj.aborted).toBe(true);
  });
});
