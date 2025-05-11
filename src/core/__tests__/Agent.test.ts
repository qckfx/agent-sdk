/**
 * Tests for the Agent class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../../Agent.js';
import { EventEmitter } from 'events';
import { AgentEvents, AgentEventType } from '../../utils/sessionUtils.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../../events/checkpoint-events.js';

// Mock dependencies
vi.mock('../../core/Agent.js', () => ({
  createAgent: vi.fn(() => ({
    toolRegistry: {
      registerTool: vi.fn(),
      on: vi.fn()
    },
    permissionManager: {},
    modelClient: {},
    environment: { type: 'local' },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    processQuery: vi.fn(async () => ({ 
      sessionId: 'test-session', 
      response: 'Test response' 
    })),
    runConversation: vi.fn(async () => ({ 
      messages: [], 
      finalResponse: 'Test response' 
    })),
    registerTool: vi.fn()
  }))
}));

vi.mock('../../utils/configValidator.js', () => ({
  validateConfig: vi.fn((config) => config)
}));

describe('Agent', () => {
  let agent: Agent;
  
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Create a fresh agent for each test
    agent = new Agent({
      modelProvider: {} as any,
      environment: { type: 'local' },
      defaultModel: 'test-model'
    });
  });
  
  afterEach(() => {
    // Clean up all listeners to prevent memory leaks
    AgentEvents.removeAllListeners();
    CheckpointEvents.removeAllListeners();
  });
  
  it('should create an agent instance', () => {
    expect(agent).toBeInstanceOf(Agent);
  });
  
  it('should require a model in processQuery if no defaultModel in config', async () => {
    const agentWithoutDefault = new Agent({
      modelProvider: {} as any,
      environment: { type: 'local' }
    });
    
    await expect(agentWithoutDefault.processQuery('test query')).rejects.toThrow(
      'Model must be supplied either in processQuery() or as defaultModel in config'
    );
  });
  
  it('should use defaultModel if no model is provided to processQuery', async () => {
    await agent.processQuery('test query');
    
    // Get the mocked implementation
    const { processQuery } = (agent as any)._core;
    
    // Check that it was called with the default model
    expect(processQuery).toHaveBeenCalledWith(
      'test query',
      'test-model',
      expect.anything()
    );
  });
  
  it('should use provided model over defaultModel in processQuery', async () => {
    await agent.processQuery('test query', 'override-model');
    
    // Get the mocked implementation
    const { processQuery } = (agent as any)._core;
    
    // Check that it was called with the override model
    expect(processQuery).toHaveBeenCalledWith(
      'test query',
      'override-model',
      expect.anything()
    );
  });
  
  it('should register callback handlers for events', () => {
    const callbacks = {
      onProcessingCompleted: vi.fn(),
      onEnvironmentStatusChanged: vi.fn(),
      onCheckpointReady: vi.fn()
    };
    
    const agentWithCallbacks = new Agent({
      modelProvider: {} as any,
      environment: { type: 'local' },
      defaultModel: 'test-model'
    }, callbacks);
    
    // Simulate legacy events
    AgentEvents.emit(AgentEventType.PROCESSING_COMPLETED, { 
      sessionId: 'test-session', 
      response: 'Test response' 
    });
    
    AgentEvents.emit(AgentEventType.ENVIRONMENT_STATUS_CHANGED, {
      environmentType: 'local',
      status: 'connected',
      isReady: true
    });
    
    CheckpointEvents.emit(CHECKPOINT_READY_EVENT, {
      sessionId: 'test-session',
      toolExecutionId: 'test-tool',
      hostCommit: 'abc123',
      shadowCommit: 'def456',
      bundle: new Uint8Array()
    });
    
    // Check that callbacks were called
    expect(callbacks.onProcessingCompleted).toHaveBeenCalledWith({
      sessionId: 'test-session', 
      response: 'Test response'
    });
    
    expect(callbacks.onEnvironmentStatusChanged).toHaveBeenCalledWith({
      environmentType: 'local',
      status: 'connected',
      isReady: true
    });
    
    expect(callbacks.onCheckpointReady).toHaveBeenCalledWith({
      sessionId: 'test-session',
      toolExecutionId: 'test-tool',
      hostCommit: 'abc123',
      shadowCommit: 'def456',
      bundle: expect.any(Uint8Array)
    });
  });
  
  it('should support on/off event subscription', () => {
    const handler = vi.fn();
    
    // Subscribe to event
    agent.on('processing:completed', handler);
    
    // Emit legacy event that should be mapped
    AgentEvents.emit(AgentEventType.PROCESSING_COMPLETED, { 
      sessionId: 'test-session', 
      response: 'Test response' 
    });
    
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ 
      sessionId: 'test-session', 
      response: 'Test response' 
    });
    
    // Reset mock
    handler.mockReset();
    
    // Unsubscribe from event
    agent.off('processing:completed', handler);
    
    // Emit again
    AgentEvents.emit(AgentEventType.PROCESSING_COMPLETED, { 
      sessionId: 'test-session', 
      response: 'Test response' 
    });
    
    // Should not be called anymore
    expect(handler).not.toHaveBeenCalled();
  });
  
  it('should forward tool registration to core agent', () => {
    const testTool = { id: 'test-tool', name: 'Test Tool' } as any;
    agent.registerTool(testTool);
    
    // Get the mocked implementation
    const { registerTool } = (agent as any)._core;
    
    // Check that it was called with the tool
    expect(registerTool).toHaveBeenCalledWith(testTool);
  });
});