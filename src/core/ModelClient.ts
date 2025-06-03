/**
 * ModelClient - Interacts with the Language Model
 * @internal
 */

import { isToolUseBlock } from '../types/llm.js';
import type {
  ModelClient,
  ModelClientConfig,
  ModelProvider,
  ModelProviderRequest,
  SessionState,
  ToolCallResponse,
} from '../types/model.js';
// Import utils as needed
import type { ToolDescription } from '../types/registry.js';
import { LogCategory } from '../utils/logger.js';
import { isSessionAborted } from '../utils/sessionUtils.js';
import { trackTokenUsage } from '../utils/TokenManager.js';

import type { PromptManager } from './PromptManager.js';
import { createDefaultPromptManager } from './PromptManager.js';

/**
 * Creates a client for interacting with the language model
 * @param config - Configuration options
 * @returns The model client interface
 * @internal
 */
export function createModelClient(config: ModelClientConfig): ModelClient {
  if (!config || !config.modelProvider) {
    throw new Error('ModelClient requires a modelProvider function');
  }

  const logger = config.logger;

  const modelProvider: ModelProvider = config.modelProvider;
  const promptManager: PromptManager = config.promptManager || createDefaultPromptManager();

  return {
    /**
     * Format our tools into Claude's expected format
     * @param toolDescriptions - Array of tool descriptions
     * @returns Tools formatted for Claude's API
     */
    formatToolsForClaude(toolDescriptions: ToolDescription[]): unknown[] {
      return toolDescriptions.map(tool => ({
        name: tool.id,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties: tool.parameters || {},
          required: tool.requiredParameters || [],
        },
      }));
    },

    /**
     * Get a tool call recommendation from the model
     * @param query - The user's query
     * @param model - The model to use for this query
     * @param toolDescriptions - Descriptions of available tools
     * @param sessionState - Current session state
     * @param options
     * @param options.signal
     * @returns The recommended tool call
     */
    async getToolCall(
      query: string,
      model: string,
      toolDescriptions: ToolDescription[],
      sessionState: SessionState,
      options?: { signal?: AbortSignal },
    ): Promise<ToolCallResponse> {
      // Fast‑exit if already aborted before work starts
      if (options?.signal?.aborted) {
        return { toolChosen: false, aborted: true };
      }

      // Format tools for Claude
      const claudeTools = this.formatToolsForClaude(toolDescriptions);

      // Get system messages and temperature from the prompt manager
      const systemMessages = promptManager.getSystemPrompts(sessionState);
      const temperature = promptManager.getTemperature(sessionState);

      // Prepare the request for AnthropicProvider
      const request: ModelProviderRequest = {
        query: query,
        tools: claudeTools,
        systemMessages: systemMessages,
        // Include systemMessage for backward compatibility
        systemMessage: systemMessages[0],
        temperature: temperature,
        // Pass the conversation history in a way AnthropicProvider can use
        sessionState,
        // Include the model parameter
        model: model,
      };

      if (claudeTools.length > 0) {
        request.tool_choice = { type: 'auto' };
      }

      let response;
      try {
        // Guard against orphaned tool calls
        const msgs = sessionState.contextWindow.getMessages();
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          if (
            last?.role === 'assistant' &&
            Array.isArray(last.content) &&
            last.content.length > 0
          ) {
            const content = last.content[0];
            if (
              content &&
              typeof content === 'object' &&
              'type' in content &&
              content.type === 'tool_use' &&
              'id' in content
            ) {
              const useId = content.id as string;
              let paired = false;

              if (msgs.length > 1) {
                const prevMsg = msgs[msgs.length - 2];
                if (prevMsg && Array.isArray(prevMsg.content) && prevMsg.content.length > 0) {
                  const prevContent = prevMsg.content[0];
                  paired = !!(
                    prevContent &&
                    typeof prevContent === 'object' &&
                    'type' in prevContent &&
                    prevContent.type === 'tool_result' &&
                    'tool_use_id' in prevContent &&
                    prevContent.tool_use_id === useId
                  );
                }
              }

              if (!paired) {
                sessionState.contextWindow.pushToolResult(useId, { aborted: true });
              }
            }
          }
        }

        if (options?.signal) {
          // Wrap call so it races with abort signal
          response = await new Promise<import('../types/llm.js').LLM.Messages.Message>(
            (resolve, reject) => {
              const onAbort = () => {
                reject(new Error('AbortError'));
              };
              if (options.signal!.aborted) {
                return onAbort();
              }
              options.signal!.addEventListener('abort', onAbort);

              modelProvider(request)
                .then(r => {
                  options.signal!.removeEventListener('abort', onAbort);
                  resolve(r);
                })
                .catch(err => {
                  options.signal!.removeEventListener('abort', onAbort);
                  reject(err);
                });
            },
          );
        } else {
          response = await modelProvider(request);
        }
      } catch (error) {
        if ((error as Error).message === 'AbortError') {
          return { toolChosen: false, aborted: true };
        }
        logger?.error('⚠️ MODEL_CLIENT error calling modelProvider:', error, LogCategory.MODEL);
        throw error;
      }

      // Track token usage from response
      if (response.usage) {
        trackTokenUsage(response, sessionState);
      }

      logger?.debug('Response:', JSON.stringify(response, null, 2), LogCategory.MODEL);
      // Check if Claude wants to use a tool - look for tool_use in the content
      const hasTool =
        Array.isArray(response.content) && response.content.some((c: any) => c.type === 'tool_use');

      if (hasTool && response.content) {
        logger?.debug('hasTool:', hasTool, LogCategory.MODEL);
        // Extract the tool use from the response and check its type
        const toolUse = Array.isArray(response.content)
          ? response.content.find(isToolUseBlock)
          : undefined;

        if (toolUse) {
          // Add the assistant's tool use response to the conversation history only if not aborted
          // NOTE: We no longer mutate the ContextWindow here. The caller (e.g. the
          // FsmDriver) is responsible for appending the `tool_use` message once it
          // has successfully parsed the model response. Mutating the history in
          // two different layers led to duplicate `tool_use` blocks with the same
          // ID, which in turn violated Anthropic's constraint that tool_use IDs
          // be unique within a conversation. Duplicates manifested as
          // `invalid_request_error: \`tool_use\` ids must be unique` errors from
          // the Claude API. By centralising this responsibility in the driver we
          // guarantee that each tool invocation is recorded exactly once.

          const toolCallResponse = {
            toolCall: {
              toolId: toolUse.name,
              args: toolUse.input,
              toolUseId: toolUse.id, // Save this for returning results
            },
            toolChosen: true,
            aborted: isSessionAborted(sessionState), // Check current abort status
          };

          return toolCallResponse;
        }
      }

      return { response: response, toolChosen: false, aborted: isSessionAborted(sessionState) };
    },

    /**
     * Generate a response to the user based on tool execution results
     * @param query - The original user query
     * @param model - The model to use for this query
     * @param toolDescriptions - Descriptions of available tools
     * @param sessionState - Current session state
     * @param options
     * @param options.tool_choice
     * @param options.tool_choice.type
     * @param options.signal
     * @returns The generated response
     */
    async generateResponse(
      query: string,
      model: string,
      toolDescriptions: ToolDescription[],
      sessionState: SessionState,
      options?: { tool_choice?: { type: string }; signal?: AbortSignal },
    ): Promise<import('../types/llm.js').LLM.Messages.Message> {
      // Early abort check
      if (options?.signal?.aborted) {
        throw new Error('AbortError');
      }
      // Format tools for Claude
      const claudeTools = this.formatToolsForClaude(toolDescriptions);

      // Get system messages and temperature from the prompt manager
      const systemMessages = promptManager.getSystemPrompts(sessionState);
      const temperature = promptManager.getTemperature(sessionState);

      const prompt: ModelProviderRequest = {
        tools: claudeTools,
        sessionState,
        systemMessages,
        // Include systemMessage for backward compatibility
        systemMessage: systemMessages[0],
        temperature,
        // Include the model parameter
        model: model,
      };

      // Add optional tool_choice if provided
      if (options?.tool_choice) {
        prompt.tool_choice = options.tool_choice;
      }

      // Guard against orphaned tool calls
      const msgs = sessionState.contextWindow.getMessages();
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.length > 0) {
          const content = last.content[0];
          if (
            content &&
            typeof content === 'object' &&
            'type' in content &&
            content.type === 'tool_use' &&
            'id' in content
          ) {
            const useId = content.id as string;
            let paired = false;

            if (msgs.length > 1) {
              const prevMsg = msgs[msgs.length - 2];
              if (prevMsg && Array.isArray(prevMsg.content) && prevMsg.content.length > 0) {
                const prevContent = prevMsg.content[0];
                paired = !!(
                  prevContent &&
                  typeof prevContent === 'object' &&
                  'type' in prevContent &&
                  prevContent.type === 'tool_result' &&
                  'tool_use_id' in prevContent &&
                  prevContent.tool_use_id === useId
                );
              }
            }

            if (!paired) {
              sessionState.contextWindow.pushToolResult(useId, { aborted: true });
            }
          }
        }
      }

      const response: import('../types/llm.js').LLM.Messages.Message = await (options?.signal
        ? new Promise((resolve, reject) => {
            const onAbort = () => reject(new Error('AbortError'));
            if (options.signal!.aborted) return onAbort();
            options.signal!.addEventListener('abort', onAbort);
            modelProvider(prompt)
              .then(r => {
                options.signal!.removeEventListener('abort', onAbort);
                resolve(r);
              })
              .catch(err => {
                options.signal!.removeEventListener('abort', onAbort);
                reject(err);
              });
          })
        : modelProvider(prompt));

      // Track token usage from response
      if (response.usage) {
        trackTokenUsage(response, sessionState);
      }

      return response;
    },
  };
}
