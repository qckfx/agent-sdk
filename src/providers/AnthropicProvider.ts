/**
 * AnthropicProvider - Handles interactions with Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import { 
  AnthropicConfig,  
  AnthropicProvider, 
  ModelProviderRequest, 
  ContentBlockWithCache,
  ToolWithCache,
  SystemWithCache
} from '../types/index.js';
import { LogCategory } from '../types/logger.js';
import { Logger } from '../utils/logger.js';
import { tokenManager as defaultTokenManager } from '../utils/TokenManager.js';
import dotenv from 'dotenv';

dotenv.config();

export { AnthropicProvider };

// Maximum token limit for Claude API requests
const MAX_TOKEN_LIMIT = 200000;
// Target token limit after compression (half of max to provide ample buffer)
const TARGET_TOKEN_LIMIT = MAX_TOKEN_LIMIT / 2;

/**
 * Exponential backoff implementation for rate limit handling
 * @param fn - Function to call with retry logic
 * @param maxRetries - Maximum number of retry attempts
 * @param initialDelay - Initial delay in milliseconds
 * @param maxDelay - Maximum delay cap in milliseconds
 * @param logger - Logger instance
 * @returns Result of the function call
 */
async function withRetryAndBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  initialDelay = 1000,
  maxDelay = 30000,
  logger?: Logger
): Promise<T> {
  let retries = 0;
  let delay = initialDelay;

  // Using retries with defined maxRetries, so no infinite loop
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      // Cast to a type that includes typical API error properties
      const apiError = error as {
        status?: number;
        response?: { status?: number };
        message?: string;
      };
      
      // Check if it's a rate limit error (HTTP 429)
      const isRateLimit = 
        apiError.status === 429 || 
        apiError.response?.status === 429 ||
        (apiError.message && apiError.message.includes('rate_limit_error'));

      // If max retries reached or not a rate limit error, rethrow
      if (retries >= maxRetries || !isRateLimit) {
        throw error;
      }

      // Increment retry count and calculate next delay
      retries++;
      
      // Apply exponential backoff with jitter
      const jitter = Math.random() * 0.3 * delay;
      delay = Math.min(delay * 1.5 + jitter, maxDelay);

      // Log the retry attempt
      if (logger) {
        logger.warn(
          `Rate limit hit, retrying in ${Math.round(delay)}ms (attempt ${retries}/${maxRetries})`,
          LogCategory.MODEL
        );
      } else {
        console.warn(`Rate limit hit, retrying in ${Math.round(delay)}ms (attempt ${retries}/${maxRetries})`);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This line will never be reached due to the for loop and return/throw,
  // but TypeScript requires it for compile-time checking
  throw new Error('Maximum retries exceeded');
}

/**
 * Creates a provider for Anthropic's Claude API
 * @param config - Configuration options
 * @returns The provider function
 */
export const createAnthropicProvider = (config: AnthropicConfig): AnthropicProvider => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic provider requires an API key');
  }
  
  const model = config.model || 'claude-3-7-sonnet-20250219';
  const maxTokens = config.maxTokens || 4096;
  const logger = config.logger;
  
  // Use the provided tokenManager or fall back to the default
  const tokenManager = config.tokenManager || defaultTokenManager;
  
  // By default, enable caching unless explicitly disabled
  const cachingEnabled = config.cachingEnabled !== undefined ? config.cachingEnabled : true;
  
  // Create Anthropic client
  const anthropic = new Anthropic({
    apiKey
  });
  
  /**
   * Provider function that handles API calls to Claude
   * @param prompt - The prompt object
   * @returns The API response
   */
  return async (prompt: ModelProviderRequest): Promise<Anthropic.Messages.Message> => {
    try {
      // Check if caching is enabled either at the provider level or in the prompt
      const shouldUseCache = prompt.cachingEnabled !== undefined 
        ? prompt.cachingEnabled 
        : cachingEnabled;
      
      if (prompt.sessionState?.contextWindow && prompt.sessionState.contextWindow.getLength() > 0) {
        logger?.debug('Calling Anthropic API', LogCategory.MODEL, { 
          model,
          messageCount: prompt.sessionState.contextWindow.getLength()
        });
      } else {
        logger?.debug('Calling Anthropic API', LogCategory.MODEL, { model, prompt: 'No messages provided' });
      }

      const conversationHistory = prompt.sessionState?.contextWindow?.getMessages() || [];
      
      // Proactively check token count if conversation history is getting long (> 8 messages)
      if (prompt.sessionState && conversationHistory.length > 2) {
        try {
          // Count tokens
          const tokenCountParams: Anthropic.Messages.MessageCountTokensParams = {
            model,
            messages: conversationHistory as Anthropic.MessageParam[],
            system: prompt.systemMessage
          };
          
          // If caching is enabled, we need to handle system differently
          if (shouldUseCache) {
            // The count tokens endpoint doesn't support system as an array,
            // so we'll just use the text content for token counting
            tokenCountParams.system = typeof prompt.systemMessage === 'string' ? 
              prompt.systemMessage : JSON.stringify(prompt.systemMessage);
          }
          
          // Add tools if provided
          if (prompt.tools) {
            tokenCountParams.tools = prompt.tools as Anthropic.Tool[];
          }
          
          const tokenCount = await anthropic.messages.countTokens(tokenCountParams);
          logger?.debug('Proactive token count check', LogCategory.MODEL, { tokenCount: tokenCount.input_tokens });
          
          // If over the limit, compress before sending
          if (tokenCount.input_tokens > TARGET_TOKEN_LIMIT) {
            logger?.warn(
              `Token count (${tokenCount.input_tokens}) exceeds target limit (${TARGET_TOKEN_LIMIT}). Compressing conversation.`,
              LogCategory.MODEL,
              {
                tokenCount: tokenCount.input_tokens,
                targetLimit: TARGET_TOKEN_LIMIT,
                maxLimit: MAX_TOKEN_LIMIT,
                messageCount: conversationHistory.length,
                systemMessageLength: prompt.systemMessage?.length || 0,
                toolCount: prompt.tools?.length || 0
              }
            );
            
            // Ensure we pass the logger that matches the expected interface
            tokenManager.manageConversationSize(
              prompt.sessionState,
              TARGET_TOKEN_LIMIT,
              logger
            );
            
            logger?.info(
              `Compressed conversation history to ${prompt.sessionState.contextWindow.getLength()} messages before API call.`,
              LogCategory.MODEL
            );
          }
        } catch (error) {
          // If token counting fails, just log and continue
          logger?.warn('Token counting failed, continuing with uncompressed conversation', LogCategory.MODEL, error instanceof Error ? error : String(error));
        }
      }

      logger?.debug('Preparing API call with caching configuration', LogCategory.MODEL, { 
        cachingEnabled: shouldUseCache 
      });
      
      // If caching is enabled and tools are provided, add cache_control to the last tool
      let modifiedTools = prompt.tools;
      if (shouldUseCache && prompt.tools && prompt.tools.length > 0) {
        // Create a deep copy to avoid modifying the original tools
        modifiedTools = JSON.parse(JSON.stringify(prompt.tools)) as Anthropic.Tool[];
        const lastToolIndex = modifiedTools.length - 1;
        
        // Add cache_control to the last tool using our extended type
        const toolWithCache = modifiedTools[lastToolIndex] as ToolWithCache;
        toolWithCache.cache_control = { type: "ephemeral" };
        
        console.log(`AnthropicProvider: Added cache_control to the last tool: ${toolWithCache.name}`);
      }
      
      // Format system message with cache_control if caching is enabled
      let systemContent: string | SystemWithCache = prompt.systemMessage || '';
      if (shouldUseCache && prompt.systemMessage) {
        // Convert system message to array of content blocks for caching
        systemContent = [
          {
            type: "text", 
            text: prompt.systemMessage,
            cache_control: { type: "ephemeral" }
          }
        ];
        
        console.log('AnthropicProvider: Added cache_control to system message');
      }
      
      // Add cache_control to the last message in conversation history if available
      let modifiedMessages = prompt.sessionState?.contextWindow?.getMessages() || [];
      if (shouldUseCache && 
          prompt.sessionState?.contextWindow && 
          prompt.sessionState.contextWindow.getLength() > 0) {
        
        // Create a deep copy to avoid modifying the original conversation history
        modifiedMessages = JSON.parse(JSON.stringify(modifiedMessages)) as Anthropic.MessageParam[];
        
        // Find the last user message to add cache_control
        for (let i = modifiedMessages.length - 1; i >= 0; i--) {
          if (modifiedMessages[i].role === 'user') {
            // Get the content array from the last user message
            const content = modifiedMessages[i].content;
            
            if (Array.isArray(content) && content.length > 0) {
              // Add cache_control to the last content block
              const lastContentIndex = content.length - 1;
              const contentWithCache = content[lastContentIndex] as ContentBlockWithCache;
              contentWithCache.cache_control = { type: "ephemeral" };
              
              console.log(`AnthropicProvider: Added cache_control to last user message at index ${i} with type ${content[lastContentIndex].type}`);
            } else if (typeof content === 'string') {
              // If content is a string, convert to content block array with cache_control
              modifiedMessages[i].content = [{
                type: "text",
                text: content,
                cache_control: { type: "ephemeral" }
              }];
              
              console.log(`AnthropicProvider: Converted string content to block with cache_control in last user message at index ${i}`);
            }
            break;
          }
        }
      }
      
      // Prepare API call parameters
      const apiParams: Anthropic.Messages.MessageCreateParams = {
        model,
        max_tokens: maxTokens,
        // System will be set based on caching configuration
        messages: modifiedMessages,
        temperature: prompt.temperature
      };
      
      // Handle system messages based on new multi-message support
      if (prompt.systemMessages && prompt.systemMessages.length > 0) {
        // If systemMessages array is provided and has content, use that
        // For Claude API compatibility, only use the first system message
        // in the standard system parameter, and include the rest in the messages array
        
        // Make sure we have at least one system message
        if (prompt.systemMessages[0]) {
          // Set the first one as the official system message
          if (shouldUseCache) {
            // For cached requests, use an array of content blocks
            (apiParams as unknown as { system: Array<{type: string; text: string; cache_control?: {type: string}}> }).system = [{
              type: 'text',
              text: prompt.systemMessages[0],
              cache_control: { type: 'ephemeral' }
            }];
          } else {
            // For non-cached requests, use a simple string
            apiParams.system = prompt.systemMessages[0];
          }
        }
        
        // If there are additional system messages (beyond the first),
        // add them as assistant role messages at the beginning of the conversation
        if (prompt.systemMessages.length > 1) {
          const additionalSystemMessages = prompt.systemMessages.slice(1).map((msg, index) => {
            // We only want to add cache_control to the directory structure message (index 0 of the additional messages)
            const addCacheControlToThisMessage = shouldUseCache && index === 0;
            
            const systemMsg: Anthropic.Messages.MessageParam = {
              role: 'assistant', // Using 'assistant' role instead of 'system'
              content: addCacheControlToThisMessage ? [{
                type: 'text',
                text: msg,
                cache_control: { type: 'ephemeral' }
              }] : msg
            };
            return systemMsg;
          });
          
          // Add the additional system messages at the beginning of the messages array
          apiParams.messages = [...additionalSystemMessages, ...apiParams.messages];
        }
      } else if (shouldUseCache && Array.isArray(systemContent)) {
        // For cached requests with older style, system must be an array of content blocks
        (apiParams as unknown as { system: Array<{type: string; text: string; cache_control?: {type: string}}> }).system = systemContent;
      } else {
        // For non-cached requests with older style, system is a simple string
        apiParams.system = prompt.systemMessage;
      }
      
      // Add tools if provided (for tool use mode)
      if (modifiedTools) {
        apiParams.tools = modifiedTools as Anthropic.Tool[];
      }
      
      // Add tool_choice if provided
      if (prompt.tool_choice) {
        apiParams.tool_choice = prompt.tool_choice as Anthropic.ToolChoice;
      }
      
      try {
        // Make the API call with retry and backoff for rate limits
        const response = await withRetryAndBackoff(
          () => anthropic.messages.create(apiParams),
          5, // max retries
          1000, // initial delay in ms
          30000, // max delay in ms
          logger
        );
        
        // Cast response to Message type
        const messageResponse = response as Anthropic.Messages.Message;
        
        // Make sure token usage information is available for tracking
        if (!messageResponse.usage) {
          logger?.warn('Token usage information not provided in the response', LogCategory.MODEL);
        }
        
        // Log cache metrics if available
        if (messageResponse && messageResponse.usage && 
            (messageResponse.usage.cache_creation_input_tokens || messageResponse.usage.cache_read_input_tokens)) {
          logger?.info('Cache metrics', LogCategory.MODEL, { 
            cache_creation_input_tokens: messageResponse.usage.cache_creation_input_tokens || 0,
            cache_read_input_tokens: messageResponse.usage.cache_read_input_tokens || 0,
            input_tokens: messageResponse.usage.input_tokens,
            output_tokens: messageResponse.usage.output_tokens,
            cache_hit: messageResponse.usage.cache_read_input_tokens ? true : false
          });
          
          // Calculate savings from caching if applicable
          if (messageResponse.usage.cache_read_input_tokens) {
            const cacheSavings = {
              tokens: messageResponse.usage.cache_read_input_tokens,
              percentage: Math.round((messageResponse.usage.cache_read_input_tokens / 
                (messageResponse.usage.input_tokens + messageResponse.usage.cache_read_input_tokens)) * 100),
            };
            
            logger?.info('Cache performance', LogCategory.MODEL, {
              saved_tokens: cacheSavings.tokens,
              savings_percentage: `${cacheSavings.percentage}%`
            });
          }
        }
        
        logger?.debug('Anthropic API response', LogCategory.MODEL, { 
          id: messageResponse.id,
          usage: messageResponse.usage,
          contentTypes: messageResponse.content?.map((c: Anthropic.Messages.ContentBlock) => c.type)
        });

        // Handle empty content array by providing a fallback message
        if (!messageResponse.content || messageResponse.content.length === 0) {
          // Create a fallback content that matches Anthropic's expected format
          const fallbackContent: Anthropic.TextBlock = {
            type: "text", 
            text: "I just wanted to check in that everything looks okay with you, please let me know if you'd like to me change anything or continue on.",
            citations: []
          };
          messageResponse.content = [fallbackContent];
          logger?.debug('Added fallback content for empty response', LogCategory.MODEL, { content: messageResponse.content });
        }
        
        return messageResponse;
      } catch (error: unknown) {
        // Cast to a type that includes typical API error properties
        const apiError = error as {
          status?: number;
          message?: string;
          body?: unknown;
          response?: { body?: unknown };
        };
        
        // Check for token limit error
        const isTokenLimitError = 
          apiError.status === 400 && 
          (apiError.message?.includes('prompt is too long') || 
           (apiError.message?.includes('token') && apiError.message?.includes('maximum')));
        
        // Log detailed error information for troubleshooting  
        logger?.error('API error details', LogCategory.MODEL, {
          errorStatus: apiError.status,
          errorMessage: apiError.message,
          errorBody: apiError.body || apiError.response?.body || null,
          isTokenLimitError
        });
        
        // If it's a token limit error and we have a session state and token manager, try to compress
        if (isTokenLimitError && prompt.sessionState && prompt.sessionState.contextWindow.getLength() > 0) {
          logger?.warn(
            `Token limit exceeded ${apiError.message ? `(${apiError.message})` : ''}. Attempting to compress conversation history.`,
            LogCategory.MODEL
          );
          
          // Use token manager to compress conversation to target limit (half of max)
          // Ensure we pass the logger that matches the expected interface
          tokenManager.manageConversationSize(
            prompt.sessionState,
            TARGET_TOKEN_LIMIT,
            logger
          );
          
          logger?.info(
            `Compressed conversation history to ${prompt.sessionState.contextWindow.getLength()} messages. Retrying API call.`,
            LogCategory.MODEL
          );
          
          // Update API params with compressed conversation
          apiParams.messages = prompt.sessionState.contextWindow.getMessages();
          
          // Retry the API call with compressed conversation
          const retryResponse = await withRetryAndBackoff(
            () => anthropic.messages.create(apiParams),
            3, // fewer retries for the second attempt
            1000,
            30000,
            logger
          );
          
          // Cast to Message type
          const messageRetryResponse = retryResponse as Anthropic.Messages.Message;
          
          // Handle empty content array
          if (!messageRetryResponse.content || messageRetryResponse.content.length === 0) {
            const fallbackContent: Anthropic.TextBlock = {
              type: "text", 
              text: "I just wanted to check in that everything looks okay with you, please let me know if you'd like to me change anything or continue on.",
              citations: []
            };
            messageRetryResponse.content = [fallbackContent];
          }
          
          return messageRetryResponse;
        }
        
        // If not a token limit error or compression didn't help, re-throw
        logger?.error('Error calling Anthropic API', LogCategory.MODEL, error);
        throw error;
      }
    } catch (error) {
      logger?.error('Error in Anthropic provider', LogCategory.SYSTEM, {
        error,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  };
};