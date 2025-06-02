/**
 * Types and interfaces for Anthropic provider
 */

// Deprecated – kept solely for transitional builds.  Do **not** import this
// module going forward; switch to `types/llm.ts` instead.
import { ModelProviderRequest, TokenManager } from './model.js';
import { Logger } from '../utils/logger.js';
import { ModelInfo } from './provider.js';
import type { LLM } from './llm.js';

// Map all legacy Anthropic.* symbol references to the new generic LLM types.
// This keeps the public interface unchanged while removing the dependency on
// the external SDK.

/**
 * Cache control configuration for prompt caching
 */
export interface CacheControl {
  type: "ephemeral";
}

/**
 * Cache metrics for tracking prompt caching performance
 */
export interface CacheMetrics {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Text content block
 */
export interface TextBlock {
  type: 'text';
  text: string;
  /**
   * Anthropic now always includes a `citations` field (even if `null`) on
   * every text block.  Including it here makes this local `TextBlock` shape
   * structurally compatible with the official SDK's `TextBlock` interface.
   *
   * Aligning the two shapes lets the `isTextBlock` type‑guard narrow
   * `Anthropic.Messages.Message['content']` correctly, so that callers no
   * longer need an explicit cast after `Array.filter(isTextBlock)`.
   */
  citations: unknown; // value is either array or null – we don't inspect it
  cache_control?: CacheControl;
}

/**
 * Tool use content block
 */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: CacheControl;
}

/**
 * Extended content block with cache control support
 */
export type ContentBlockWithCache = TextBlock | ToolUseBlock;

/**
 * Extended tool definition with cache control support
 */
export interface ToolWithCache {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
}

/**
 * System content block with cache control support
 * For system parameter, use an array of these objects
 */
export interface SystemContentBlock {
  type: string;
  text: string;
  cache_control?: CacheControl;
}

/**
 * System parameter with cache control support
 * This is an array of content blocks
 */
export type SystemWithCache = SystemContentBlock[];

export interface AnthropicConfig {
  model?: string;
  maxTokens?: number;
  logger?: Logger;
  tokenManager?: TokenManager;
  cachingEnabled?: boolean; // Whether to enable prompt caching
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Type for the Anthropic provider function
 */
export type AnthropicProvider = (prompt: ModelProviderRequest) => Promise<LLM.Messages.Message>;

/**
 * Factory interface with methods to create providers and get available models
 */
export interface LLMFactory {
  /**
   * Creates a provider instance
   */
  createProvider(config: AnthropicConfig): AnthropicProvider;
  
  /**
   * Returns a list of available models with their providers
   */
  getAvailableModels(llmKey: string): Promise<ModelInfo[]>;
}

/**
 * Type guard to check if a content block is a TextBlock
 * Compatible with both our internal types and Anthropic SDK types
 */
export function isTextBlock(block: any): block is TextBlock {
  return block && block.type === 'text' && 'text' in block;
}

/**
 * Type guard to check if a content block is a ToolUseBlock
 * Compatible with both our internal types and Anthropic SDK types
 */
export function isToolUseBlock(block: any): block is ToolUseBlock {
  return block && block.type === 'tool_use' && 'id' in block && 'name' in block && 'input' in block;
}