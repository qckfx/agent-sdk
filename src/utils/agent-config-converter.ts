/**
 * Converter for AgentConfigJSON to AgentConfig
 * 
 * This provides conversion functions between the Zod-validated JSON config
 * and the internal AgentConfig type expected by the Agent implementation.
 */

import { AgentConfig, RepositoryEnvironment } from '../types/main.js';
import { AgentConfigJSON } from '../../schemas/agent-config.zod.js';
import { LLMFactory } from '../public.js';

/**
 * A version of AgentConfig without the required properties so we can build it step by step.
 * This is for internal use only during the conversion process.
 */
type PartialAgentConfig = Partial<AgentConfig>;

/**
 * Convert a Zod-validated AgentConfigJSON to the internal AgentConfig type.
 * 
 * @param jsonConfig The validated JSON configuration
 * @param modelProvider The model provider to use
 * @returns A proper AgentConfig object
 */
export function convertToAgentConfig(
  jsonConfig: AgentConfigJSON, 
): AgentConfig {
  const modelProvider = LLMFactory.createProvider({ model: jsonConfig.defaultModel, cachingEnabled: jsonConfig.cachingEnabled });
  
  // Create basic config with required properties
  const config: PartialAgentConfig = {
    modelProvider,
    environment: jsonConfig.environment as RepositoryEnvironment,
  };
  
  // Add optional properties if they exist
  if (jsonConfig.defaultModel !== undefined) {
    config.defaultModel = jsonConfig.defaultModel;
  }
  
  if (jsonConfig.systemPrompt !== undefined) {
    config.systemPrompt = jsonConfig.systemPrompt;
  }
  
  if (jsonConfig.permissionMode !== undefined) {
    config.permissionMode = jsonConfig.permissionMode;
  }
  
  if (jsonConfig.allowedTools !== undefined) {
    config.allowedTools = jsonConfig.allowedTools;
  }
  
  if (jsonConfig.cachingEnabled !== undefined) {
    config.cachingEnabled = jsonConfig.cachingEnabled;
  }
  
  if (jsonConfig.tools !== undefined) {
    config.tools = jsonConfig.tools;
  }
  
  // Return as complete AgentConfig
  return config as AgentConfig;
}