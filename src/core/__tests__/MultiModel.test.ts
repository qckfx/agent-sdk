import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModelClient } from '../ModelClient.js';
import { ModelProvider, SessionState } from '../../types/model.js';
import { createContextWindow } from '../../types/contextWindow.js';
import Anthropic from '@anthropic-ai/sdk';

describe('Multi-model support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the model parameter to the provider', async () => {
    // Create a mock provider that tracks the model requested
    let lastRequestedModel = '';
    const mockProvider: ModelProvider = vi.fn().mockImplementation((request) => {
      // Store the model from the request
      lastRequestedModel = request.model;
      
      // Return a mock response
      return Promise.resolve({
        id: 'msg_mock',
        role: 'assistant',
        model: request.model,
        content: [{ type: 'text', text: 'Mock response' }]
      } as Anthropic.Messages.Message);
    });

    // Create a model client with our mock provider
    const modelClient = createModelClient({
      modelProvider: mockProvider
    });

    // Create a session state with a context window
    const sessionState: SessionState = {
      id: 'test-session',
      contextWindow: createContextWindow(),
      abortController: new AbortController()
    };

    // Test getToolCall with different models
    await modelClient.getToolCall('Hello', 'claude-3-7-sonnet-20250219', [], sessionState);
    expect(lastRequestedModel).toBe('claude-3-7-sonnet-20250219');
    
    await modelClient.getToolCall('Hello again', 'claude-3-5-sonnet-20240620', [], sessionState);
    expect(lastRequestedModel).toBe('claude-3-5-sonnet-20240620');

    // Test generateResponse with different models
    await modelClient.generateResponse('Hello', 'claude-3-haiku-20240307', [], sessionState);
    expect(lastRequestedModel).toBe('claude-3-haiku-20240307');
  });
});