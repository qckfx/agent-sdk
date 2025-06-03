/**
 * Types and interfaces for model providers
 */

import type { AgentMessage, AgentResponse, ToolDefinition } from './agent.js';

export interface ProviderOptions {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface ModelProviderInterface {
  name: string;
  generateResponse(options: GenerateOptions): Promise<AgentResponse>;
  formatMessages(messages: AgentMessage[]): unknown;
  formatTools(tools: ToolDefinition[]): unknown;
}

export interface GenerateOptions {
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  model: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Interface for model information retrieved from remote API
 */
export interface RemoteModelInfo {
  model_name: string;
  litellm_provider: string;
  max_input_tokens: number;
}

/**
 * Interface for simplified model information returned to clients
 */
export interface ModelInfo {
  model_name: string;
  provider: string;
}
