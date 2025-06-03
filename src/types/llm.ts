/**
 * Generic LLM type definitions replacing the Anthropic-specific ones.
 *
 * During the migration we keep a temporary alias under the Anthropic namespace
 * so existing code continues to compile.  Call-sites should gradually be
 * switched to the new names and the alias will then be removed.
 */

import type { Logger } from '../utils/logger.js';

import type { ModelProviderRequest, TokenManager } from './model.js';
import type { ModelInfo } from './provider.js';

// ---------------------------------------------------------------------------
// Cache-control metadata (used by Claude-style prompt caching but kept generic)
// ---------------------------------------------------------------------------

export interface CacheControl {
  type: 'ephemeral';
}

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
  citations?: unknown;
  cache_control?: CacheControl;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: CacheControl;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  cache_control?: CacheControl;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
export type ContentBlockParam = ContentBlock | string;
export type ContentBlockWithCache = ContentBlock;

// Extended tool definition with cache-control – kept for backwards compat
export interface ToolWithCache extends Tool {
  cache_control?: CacheControl;
}

// System prompt represented as array of text blocks w/ cache control
export type SystemContentBlock = {
  type: string;
  text: string;
  cache_control?: CacheControl;
};

export type SystemWithCache = SystemContentBlock[];

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentBlock[] | string;
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
}

export interface ToolChoice {
  type: string; // e.g. "auto" | "required"
}

// ---------------------------------------------------------------------------
// Provider factory interfaces
// ---------------------------------------------------------------------------

export interface LLMConfig {
  model?: string;
  maxTokens?: number;
  logger?: Logger;
  tokenManager?: TokenManager;
  cachingEnabled?: boolean;
}

export type LLMProvider = (prompt: ModelProviderRequest) => Promise<Message>;

export interface LLMFactory {
  createProvider(config: LLMConfig): LLMProvider;
  getAvailableModels(llmKey?: string, logger?: Logger): Promise<ModelInfo[]>;
}

// ---------------------------------------------------------------------------
// Runtime helpers (ported from the previous implementation)
// ---------------------------------------------------------------------------

/**
 *
 * @param block
 */
export function isTextBlock(block: any): block is TextBlock {
  return block && block.type === 'text' && 'text' in block;
}

/**
 *
 * @param block
 */
export function isToolUseBlock(block: any): block is ToolUseBlock {
  return block && block.type === 'tool_use' && 'id' in block && 'name' in block && 'input' in block;
}

// ---------------------------------------------------------------------------
// Temporary compatibility shim ------------------------------------------------
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace LLM {
  export namespace Messages {
    export type Message = import('./llm.js').Message;
    export type MessageParam = Message;
    export type ContentBlock = import('./llm.js').ContentBlock;
    export type ContentBlockParam = ContentBlock;
    export type TextBlock = import('./llm.js').TextBlock;
  }
  export type Tool = import('./llm.js').Tool;
  export type ToolChoice = import('./llm.js').ToolChoice;
}

// Provide the old Anthropic.* symbol so that existing imports keep compiling
// until the rename is finished.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Anthropic {
  export import Messages = LLM.Messages;
  export type Tool = import('./llm.js').Tool;
  export type ToolChoice = import('./llm.js').ToolChoice;
}
