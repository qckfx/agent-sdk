/**
 * AnthropicProvider - Handles interactions with Anthropic's Claude API
 */

// NOTE: While this file keeps its original name (AnthropicProvider) and
// exported factory (`createAnthropicProvider`) to avoid any downstream code
// changes, the implementation below no longer talks to the Anthropic Claude
// API.  Instead, it transparently converts the Anthropic-shaped request into
// an OpenAI Chat Completions request, forwards that to the OpenAI REST
// endpoint, and then converts the response back into Claude-compatible
// message objects.

// We still import the official Anthropic SDK purely for its *types*.  The
// actual client instance is no longer used for the `create` call – doing so
// would require an Anthropic API key, which we no longer need once the request
// is proxied to OpenAI.
import Anthropic from '@anthropic-ai/sdk';
// Official OpenAI SDK
import OpenAI from 'openai';
import { 
  AnthropicConfig,  
  AnthropicProvider, 
  ModelProviderRequest, 
  ContentBlockWithCache,
  ToolWithCache,
  SystemWithCache,
  RemoteModelInfo,
  ModelInfo,
} from '../types/index.js';
import { LogCategory } from '../types/logger.js';
import { Logger } from '../utils/logger.js';
import { tokenManager as defaultTokenManager } from '../utils/TokenManager.js';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const LIST_MODELS_URL = process.env.LIST_MODELS_URL!;

// ---------------------------------------------------------------------------
// OpenAI interop helpers
// ---------------------------------------------------------------------------

/**
 * Convert Anthropic tool format (name/description/input_schema) → OpenAI
 * function tools format.
 */
import type {
  ChatCompletionMessageParam,
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions';

function convertToolsToOpenAI(tools?: Anthropic.Tool[]): ChatCompletionTool[] | undefined {
  if (!tools) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Convert a single Anthropic message → OpenAI chat message object.
 */
function convertMessageToOpenAI(msg: Anthropic.Messages.MessageParam): ChatCompletionMessageParam {
  const role = msg.role;

  // Helper to collapse text blocks into a single string
  const collapseText = (content: Anthropic.Messages.ContentBlock[] | string): string => {
    if (typeof content === 'string') return content;

    return content
      .filter((c): c is Anthropic.TextBlock => (c as any).type === 'text')
      .map((c) => (c as any).text)
      .join('\n');
  };

  if (role === 'assistant') {
    // Check if this is a tool_use block
    if (Array.isArray(msg.content) && msg.content.length > 0 && msg.content[0].type === 'tool_use') {
      const tu = msg.content[0] as unknown as {
        id: string;
        name: string;
        input: Record<string, unknown>;
      };
      return {
        role: 'assistant',
        // When tool calls are present, `content` must be null (per API spec)
        content: null,
        tool_calls: [
          {
            id: tu.id,
            type: 'function',
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input ?? {}),
            },
          },
        ],
      } as unknown as ChatCompletionMessageParam; // Cast to satisfy structural match
    }
  }

  if (role === 'user') {
    // Tool results in Anthropic are stored as user role with tool_result type,
    // but by the time they reach here they should be in the conversation with
    // role 'tool'.  We'll simply stringify the content.
    const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    // Try to locate the tool_use_id for linkage
    let tool_call_id: string | undefined;
    if (Array.isArray(msg.content) && msg.content.length > 0 && (msg.content[0] as any).tool_use_id) {
      tool_call_id = (msg.content[0] as any).tool_use_id;
    }
    if (tool_call_id) {
      // Proper tool response message
      return {
        role: 'tool',
        content: contentStr,
        tool_call_id,
      } as unknown as ChatCompletionMessageParam;
    }

    // If we cannot identify the originating tool call, treat it as a plain user
    // message so that we do not violate the OpenAI schema (which requires
    // tool_call_id for `role:"tool"`).
    return {
      role: 'user',
      content: contentStr,
    } as unknown as ChatCompletionMessageParam;
  }

  // Default: treat as a plain text message
  return {
    role: role as any, // 'user' | 'assistant' | 'system'
    content: collapseText(msg.content as any),
  } as unknown as ChatCompletionMessageParam;
}

/**
 * Convert Anthropic API params to an OpenAI chat/completions request body.
 */
function convertAnthropicRequestToOpenAI(apiParams: Anthropic.Messages.MessageCreateParams): ChatCompletionCreateParams {
  const messages: ChatCompletionMessageParam[] = [];

  // Handle system prompt if provided
  if ('system' in apiParams && apiParams.system) {
    if (typeof (apiParams as any).system === 'string') {
      messages.push({ role: 'system', content: (apiParams as any).system } as ChatCompletionMessageParam);
    } else if (Array.isArray((apiParams as any).system)) {
      const blocks = (apiParams as any).system as Array<{ text: string }>;
      const systemText = blocks.map((b) => b.text).join('\n');
      messages.push({ role: 'system', content: systemText } as ChatCompletionMessageParam);
    }
  }

  // Convert conversation history
  if (apiParams.messages) {
    for (const m of apiParams.messages) {
      messages.push(convertMessageToOpenAI(m));
    }
  }

  // Compose final request
  return {
    model: apiParams.model,
    temperature: apiParams.temperature ?? 0.7,
    messages,
    tools: convertToolsToOpenAI(apiParams.tools as Anthropic.Tool[]),
    // The OpenAI type expects ChatCompletionToolChoiceOption or undefined.
    tool_choice: apiParams.tool_choice?.type as ChatCompletionToolChoiceOption | undefined,
  } satisfies ChatCompletionCreateParams;
}

/**
 * Perform the Chat Completions request via the official OpenAI SDK instead of a
 * raw `fetch`.  This returns the strongly-typed `ChatCompletion` object.
 */
let cachedOpenAIClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (cachedOpenAIClient) return cachedOpenAIClient;

  const apiKey = process.env.OPENAI_API_KEY;

  const baseURL = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

  cachedOpenAIClient = new OpenAI({ apiKey, baseURL });
  return cachedOpenAIClient;
}

async function callOpenAI(
  requestBody: ChatCompletionCreateParams,
  logger?: Logger,
): Promise<ChatCompletion> {
  const openai = getOpenAIClient();

  logger?.debug('Dispatching request to OpenAI (SDK)', LogCategory.MODEL, {
    model: requestBody.model,
    messageCount: requestBody.messages?.length ?? 0,
  });

  try {
    const response = await openai.chat.completions.create(requestBody);
    return response as ChatCompletion;
  } catch (error: unknown) {
    // The OpenAI SDK throws rich errors.  Normalise a subset of their fields so
    // that the retry logic in `withRetryAndBackoff` continues to work.
    if (error && typeof error === 'object') {
      const err = error as { status?: number; message?: string };
      const normalised = new Error(err.message || 'OpenAI API error');
      if (err.status) (normalised as any).status = err.status;
      throw normalised;
    }
    throw error;
  }
}

/**
 * Convert an OpenAI ChatCompletion response back into Anthropic's Message
 * shape so that the rest of the codebase remains unchanged.
 */
function convertOpenAIResponseToAnthropic(openaiResp: ChatCompletion): Anthropic.Messages.Message {
  const choice = openaiResp.choices?.[0];
  const msg = choice?.message ?? {};

  // Build content blocks
  const contentBlocks: any[] = [];

  if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    // Each tool call becomes a tool_use block
    for (const tc of msg.tool_calls) {
      const input = (() => {
        try {
          return JSON.parse(tc.function.arguments || '{}');
        } catch {
          return {};
        }
      })();
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  if (msg.content) {
    contentBlocks.push({
      type: 'text',
      text: msg.content,
      citations: [],
    });
  }

  const usage = openaiResp.usage || {};

  const anthropicMessage: Anthropic.Messages.Message = {
    id: openaiResp.id,
    role: 'assistant',
    content: contentBlocks,
    model: openaiResp.model,
    stop_reason: choice?.finish_reason ?? 'stop',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  } as any; // Cast to satisfy structural typing

  return anthropicMessage;
}

export { AnthropicProvider };

/**
 * Creates a model list fetcher that provides methods to fetch and retrieve available models
 * @returns Object with fetchModelList and getAvailableModels methods
 */
function createModelListFetcher() {
  // Define Zod schema for model response
  const ModelInfoSchema = z.object({
    model_name: z.string(),
    model_info: z.object({
      litellm_provider: z.string().optional(),
      key: z.string().optional(),
      max_input_tokens: z.number().optional(),
      max_tokens: z.number().optional(),
    }),
    litellm_params: z.object({
      model: z.string().optional(),
    }).optional(),
  });

  const ModelListResponseSchema = z.object({
    data: z.array(ModelInfoSchema),
  });

  let cache: RemoteModelInfo[] | null = null;
  let inflight: Promise<RemoteModelInfo[]> | null = null;

  /**
   * Fetches the list of available models from the remote API
   * @returns Promise with array of model information
   */
  async function fetchModelList(): Promise<RemoteModelInfo[]> {
    console.log(`Fetching model list from ${LIST_MODELS_URL}`);
    
    // If we already have an inflight request, return it
    if (inflight) return inflight;

    // If we have cached results, return them
    if (cache) return cache;

    // Create a new fetch request
    inflight = (async () => {
      try {
        // Check if we have an API URL configured
        if (!LIST_MODELS_URL) {
          console.warn('LIST_MODELS_URL not configured, using empty model list');
          return [];
        }

        // Fetch the models list
        const response = await fetch(LIST_MODELS_URL);
        if (!response.ok) {
          console.warn(`Failed to fetch models: ${response.status} ${response.statusText}`);
          return [];
        }

        // Parse the response
        const data = await response.json();
        
        // Log first model object for debugging
        if (data && data.data && data.data.length > 0) {
          console.log('First model from API:', JSON.stringify(data.data[0], null, 2));
        }
        
        // Parse with Zod schema
        const result = ModelListResponseSchema.safeParse(data);
        
        if (!result.success) {
          console.warn(`Failed to parse model list: ${result.error.message}`);
          console.log('Full error:', JSON.stringify(result.error.format(), null, 2));
          return [];
        }
        
        // Transform the models to our internal format
        const modelInfo = result.data.data.map(model => ({
          model_name: model.model_name,
          litellm_provider: model.model_info.litellm_provider || 
                           (model.litellm_params?.model?.split('/')[0] || 'unknown'),
          max_input_tokens: model.model_info.max_input_tokens || 
                           model.model_info.max_tokens || 
                           100000 // fallback default
        }));

        // Store in cache and return
        cache = modelInfo;
        return modelInfo;
      } catch (error) {
        console.warn(`Error fetching model list: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      } finally {
        // Clear the inflight request
        inflight = null;
      }
    })();

    return inflight;
  }

  /**
   * Returns the list of available models with their providers
   * @returns Promise with array of model names and providers
   */
  async function getAvailableModels(): Promise<ModelInfo[]> {
    const models = await fetchModelList();
    return models.map(model => ({
      model_name: model.model_name,
      provider: model.litellm_provider
    }));
  }

  return { fetchModelList, getAvailableModels };
}

// Default token limits - these will be overridden per model if available
const DEFAULT_MAX_TOKEN_LIMIT = 200000;
// Target token limit after compression (half of max to provide ample buffer)
const DEFAULT_TARGET_TOKEN_LIMIT = DEFAULT_MAX_TOKEN_LIMIT / 2;

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
function createAnthropicProvider(config: AnthropicConfig): AnthropicProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.LLM_BASE_URL || 'https://api.anthropic.com/v1';
  
  const model = config.model || 'claude-3-7-sonnet';
  const maxTokens = config.maxTokens || 4096;
  const logger = config.logger;

  console.log('AnthropicProvider: Using model', model);
  
  // Use the provided tokenManager or fall back to the default
  const tokenManager = config.tokenManager || defaultTokenManager;
  
  // By default, enable caching unless explicitly disabled
  const cachingEnabled = config.cachingEnabled !== undefined ? config.cachingEnabled : true;
  
  // Create Anthropic client *only* when we have an API key.  When running in
  // OpenAI proxy mode the client is not required, but we keep the variable
  // around (typed as `any`) so that the remainder of the legacy code still
  // type-checks.
  const anthropic: any = apiKey
    ? new Anthropic({
        apiKey,
        baseURL,
      })
    : null;
    
  // Create the model list fetcher
  const modelFetcher = createModelListFetcher();
  
  /**
   * Provider function that handles API calls to Claude
   * @param prompt - The prompt object
   * @returns The API response
   */
  const provider = async (prompt: ModelProviderRequest): Promise<Anthropic.Messages.Message> => {
    try {
      // Use the model from the prompt, which is now required
      const modelToUse = prompt.model!;
      
      // Get dynamic max input tokens for the chosen model
      let dynamicMaxInputTokens: number | undefined;
      
      try {
        // Attempt to fetch model list to determine model-specific token limits
        const list = await modelFetcher.fetchModelList();
        const info = list.find((m: RemoteModelInfo) => m.model_name === modelToUse);
        dynamicMaxInputTokens = info?.max_input_tokens;
        
        if (info) {
          logger?.debug('Using model-specific token limits', LogCategory.MODEL, {
            model: modelToUse,
            max_input_tokens: info.max_input_tokens
          });
        }
      } catch (error) {
        logger?.warn('Failed to fetch model-specific token limits', LogCategory.MODEL, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Use dynamic token limits if available, otherwise fall back to defaults
      const MAX_TOKEN_LIMIT = dynamicMaxInputTokens ?? DEFAULT_MAX_TOKEN_LIMIT;
      const TARGET_TOKEN_LIMIT = MAX_TOKEN_LIMIT / 2;

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
          
          let tokenCount: { input_tokens: number } | null = null;
          if (anthropic && anthropic.messages && anthropic.messages.countTokens) {
            tokenCount = await anthropic.messages.countTokens(tokenCountParams);
          }

          if (tokenCount) {
            logger?.debug('Proactive token count check', LogCategory.MODEL, {
              tokenCount: tokenCount.input_tokens,
            });
          }

          // If over the limit, compress before sending
          if (tokenCount && tokenCount.input_tokens > TARGET_TOKEN_LIMIT) {
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
        model: modelToUse,
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
        // ------------------------------------------------------------------
        // 1. Convert Anthropic-style request → OpenAI Chat Completions format
        // ------------------------------------------------------------------

        const openaiRequest = convertAnthropicRequestToOpenAI(apiParams);

        // ------------------------------------------------------------------
        // 2. Perform the network request to OpenAI with retry / back-off
        // ------------------------------------------------------------------

        const openaiResponse = await withRetryAndBackoff(
          () => callOpenAI(openaiRequest, logger),
          5,
          1000,
          30000,
          logger,
        );

        // ------------------------------------------------------------------
        // 3. Convert OpenAI response → Anthropic-compatible shape
        // ------------------------------------------------------------------

        const messageResponse = convertOpenAIResponseToAnthropic(openaiResponse);
        
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
  
  return provider;
}

// Create and export the LLMFactory
export const LLMFactory = {
  createProvider: createAnthropicProvider,
  getAvailableModels: createModelListFetcher().getAvailableModels
};