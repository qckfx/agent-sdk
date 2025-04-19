/**
 * Types and interfaces for model providers
 */

import { AgentMessage, AgentResponse, ToolDefinition } from './agent.js';

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