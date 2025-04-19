/**
 * Agent factory for A/B testing
 * 
 * Creates model clients and providers from agent configurations,
 * leveraging the PromptManager for consistent prompt handling.
 */

import { createAnthropicProvider } from '../../providers/AnthropicProvider.js';
import { createModelClient } from '../../core/ModelClient.js';
import { createPromptManager } from '../../core/PromptManager.js';
import { createFilteredToolRegistry } from './tools.js';
import { AgentConfiguration } from '../models/ab-types.js';
import { createLogger, LogLevel } from '../../utils/logger.js';

// Create a logger for the agent factory
const logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'AgentFactory'
});

/**
 * Create a model provider from an agent configuration
 * This creates a standard Anthropic provider without PromptManager integration
 * 
 * @param config Agent configuration to use
 * @returns An Anthropic provider
 */
export function createProviderFromConfig(config: AgentConfiguration) {
  // Create the model provider
  return createAnthropicProvider({
    model: config.model,
    logger
  });
}

/**
 * Create a model client configured with a PromptManager 
 * and filtered tools from an agent configuration
 * 
 * @param config Agent configuration to use
 * @returns A model client configured with the appropriate PromptManager and tools
 */
export function createAgentFromConfig(config: AgentConfiguration) {
  try {
    // Create the model provider first
    const modelProvider = createProviderFromConfig(config);
    
    // Create a prompt manager from the configuration
    const promptManager = createPromptManager(
      config.systemPrompt,
      config.parameters?.temperature || 0.2
    );
    
    // Create a tool registry with filtered tools based on configuration
    const toolRegistry = createFilteredToolRegistry(config.availableTools, config.name);
    
    // Create and return the model client with the configured tools
    return createModelClient({
      modelProvider,
      promptManager,
      toolRegistry
    });
  } catch (error) {
    logger.error('Error creating agent from config', error);
    throw error;
  }
}