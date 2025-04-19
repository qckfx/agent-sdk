/**
 * Tests for the agent factory
 */

import { vi, beforeEach, describe, it, expect } from 'vitest';
import { createAgentFromConfig } from '../agent-factory';
import { AgentConfiguration } from '../../models/ab-types';

// Mock dependencies
vi.mock('../../../providers/AnthropicProvider', () => ({
  createAnthropicProvider: vi.fn(() => ({
    model: 'mock-model',
    generateMessage: vi.fn(),
    getToolCall: vi.fn(),
    generateResponse: vi.fn()
  }))
}));

vi.mock('../../../core/ModelClient', () => ({
  createModelClient: vi.fn(({ modelProvider, promptManager, toolRegistry }) => ({
    modelProvider,
    promptManager,
    toolRegistry,
    getToolCall: vi.fn(),
    generateResponse: vi.fn()
  }))
}));

vi.mock('../../../core/PromptManager', () => ({
  createPromptManager: vi.fn((systemPrompt, temperature) => ({
    systemPrompt,
    temperature,
    getSystemPrompt: vi.fn().mockReturnValue(systemPrompt),
    getSystemPrompts: vi.fn().mockReturnValue([{ role: 'system', content: systemPrompt }])
  }))
}));

vi.mock('../tools', () => ({
  createFilteredToolRegistry: vi.fn(() => ({
    id: 'mock-tool-registry',
    registerTool: vi.fn(),
    getTool: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
    getToolDescriptions: vi.fn().mockReturnValue([])
  }))
}));

// Import the mocked modules 
import { createAnthropicProvider } from '../../../providers/AnthropicProvider';
import { createModelClient } from '../../../core/ModelClient';
import { createPromptManager } from '../../../core/PromptManager'; 
import { createFilteredToolRegistry } from '../tools';

describe('Agent Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should create an agent from a configuration', async () => {
    // Arrange
    const config: AgentConfiguration = {
      id: 'test-config',
      name: 'Test Configuration',
      systemPrompt: 'You are a helpful AI assistant',
      model: 'claude-3-opus-20240229',
      temperature: 0.7,
      tools: ['bash', 'file_read'],
      environmentType: 'local',
      maxTokens: 100000,
      options: {}
    };
    
    // Act
    const agent = await createAgentFromConfig(config);
    
    // Assert
    expect(createAnthropicProvider).toHaveBeenCalled();
    expect(createModelClient).toHaveBeenCalled();
    expect(createPromptManager).toHaveBeenCalledWith(
      'You are a helpful AI assistant',
      expect.any(Number)
    );
    expect(createFilteredToolRegistry).toHaveBeenCalled();
    expect(agent).toBeDefined();
  });
});