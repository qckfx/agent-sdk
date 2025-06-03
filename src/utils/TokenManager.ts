/**
 * TokenManager - Manages conversation history token usage
 */

import type { LLM } from '../types/llm.js';
import { isToolUseBlock } from '../types/llm.js';
import type {
  SessionState,
  MessageTokenUsage,
  TokenManager as TokenManagerInterface,
} from '../types/model.js';
import type { Logger } from '../utils/logger.js';
import { LogCategory } from '../utils/logger.js';

/**
 * Tracks token usage from model responses, including cache metrics if available
 * @param response - The model response with usage information
 * @param sessionState - The current session state
 */
const trackTokenUsage = (response: LLM.Messages.Message, sessionState: SessionState): void => {
  if (response && response.usage) {
    // Initialize token tracking if it doesn't exist
    if (!sessionState.tokenUsage) {
      sessionState.tokenUsage = {
        totalTokens: 0,
        tokensByMessage: [],
      };
    }

    // Store token usage for this message
    const messageIndex = sessionState.contextWindow.getLength() - 1;
    const oldTotalTokens = sessionState.tokenUsage.totalTokens;
    sessionState.tokenUsage.totalTokens =
      response.usage.input_tokens + response.usage.output_tokens;
    // Store the input tokens for the previous message
    sessionState.tokenUsage.tokensByMessage.push({
      messageIndex: messageIndex - 1,
      tokens: response.usage.input_tokens - oldTotalTokens,
    });
    // Store the output tokens for this message
    sessionState.tokenUsage.tokensByMessage.push({
      messageIndex,
      tokens: response.usage.output_tokens,
    });

    // Track cache metrics if available
    if (
      response.usage.cache_creation_input_tokens !== undefined ||
      response.usage.cache_read_input_tokens !== undefined
    ) {
      // Initialize cache metrics if they don't exist
      if (!sessionState.cacheMetrics) {
        sessionState.cacheMetrics = {
          totalCacheWrites: 0,
          totalCacheReads: 0,
          lastRequestMetrics: {
            creation: 0,
            read: 0,
            input: response.usage.input_tokens,
          },
        };
      }

      // Update cache metrics
      if (response.usage.cache_creation_input_tokens) {
        sessionState.cacheMetrics.totalCacheWrites += response.usage.cache_creation_input_tokens;
        if (sessionState.cacheMetrics.lastRequestMetrics) {
          sessionState.cacheMetrics.lastRequestMetrics.creation =
            response.usage.cache_creation_input_tokens;
        }
      }

      if (response.usage.cache_read_input_tokens) {
        sessionState.cacheMetrics.totalCacheReads += response.usage.cache_read_input_tokens;
        if (sessionState.cacheMetrics.lastRequestMetrics) {
          sessionState.cacheMetrics.lastRequestMetrics.read =
            response.usage.cache_read_input_tokens;
        }
      }

      // Update input tokens in lastRequestMetrics
      if (sessionState.cacheMetrics.lastRequestMetrics) {
        sessionState.cacheMetrics.lastRequestMetrics.input = response.usage.input_tokens;
      }
    }
  }
};

/**
 * Manages conversation history size by removing old messages when token limit is exceeded
 * Uses a prioritized strategy that preserves user messages and recent context
 * @param sessionState - The current session state
 * @param maxTokens - Maximum number of tokens to allow (default: 60000)
 * @param logger - Optional logger for logging token management actions
 */
const manageConversationSize = (
  sessionState: SessionState,
  maxTokens: number = 60000,
  logger?: Logger,
): void => {
  if (!sessionState.tokenUsage || !sessionState.contextWindow) {
    return;
  }

  logger?.debug(
    `Need to trim history. Current tokens: ${sessionState.tokenUsage.totalTokens}, Max: ${maxTokens}`,
    LogCategory.MODEL,
  );

  // We need to trim the history
  const tokensToRemove = sessionState.tokenUsage.totalTokens - maxTokens;
  let tokensRemoved = 0;
  const removedIndices = new Set<number>();

  // Find tool_use/tool_result pairs for potential removal
  const toolPairs: Array<{ toolUseIndex: number; toolResultIndex: number; totalTokens: number }> =
    [];
  for (let i = 0; i < sessionState.contextWindow.getLength() - 15; i++) {
    // Skip the most recent 15 messages
    const message = sessionState.contextWindow.getMessages()[i];
    if (
      message.role === 'assistant' &&
      message.content &&
      Array.isArray(message.content) &&
      message.content.some((c: LLM.Messages.ContentBlockParam) => c.type === 'tool_use')
    ) {
      const toolUse = Array.isArray(message.content)
        ? message.content.find(isToolUseBlock)
        : undefined;

      if (toolUse) {
        const toolUseId = toolUse.id;

        // Look for the corresponding tool_result
        for (let j = i + 1; j < sessionState.contextWindow.getLength(); j++) {
          const resultMessage = sessionState.contextWindow.getMessages()[j];
          if (
            resultMessage.role === 'user' &&
            resultMessage.content &&
            Array.isArray(resultMessage.content) &&
            resultMessage.content.some(
              (c: LLM.Messages.ContentBlockParam) =>
                c.type === 'tool_result' && c.tool_use_id === toolUseId,
            )
          ) {
            // Calculate total tokens for this pair
            const toolUseTokens =
              sessionState.tokenUsage.tokensByMessage.find(t => t.messageIndex === i)?.tokens || 0;
            const toolResultTokens =
              sessionState.tokenUsage.tokensByMessage.find(t => t.messageIndex === j)?.tokens || 0;

            toolPairs.push({
              toolUseIndex: i,
              toolResultIndex: j,
              totalTokens: toolUseTokens + toolResultTokens,
            });
            break;
          }
        }
      }
    }
  }

  // Sort tool pairs by age (oldest first)
  toolPairs.sort((a, b) => a.toolUseIndex - b.toolUseIndex);

  // First, try removing tool_use/tool_result pairs (oldest first)
  for (const pair of toolPairs) {
    if (tokensRemoved >= tokensToRemove) {
      break;
    }

    const toolUseMessage = sessionState.contextWindow.getMessages()[pair.toolUseIndex];
    const toolResultMessage = sessionState.contextWindow.getMessages()[pair.toolResultIndex];

    logger?.debug(
      `Removing tool pair - Tool Use (index ${pair.toolUseIndex}): ${JSON.stringify(toolUseMessage.content)}`,
      LogCategory.MODEL,
    );
    logger?.debug(
      `Removing tool pair - Tool Result (index ${pair.toolResultIndex}): ${JSON.stringify(toolResultMessage.content)}`,
      LogCategory.MODEL,
    );

    removedIndices.add(pair.toolUseIndex);
    removedIndices.add(pair.toolResultIndex);
    tokensRemoved += pair.totalTokens;
    logger?.debug(`Removed tool pair - Tokens removed: ${pair.totalTokens}`, LogCategory.MODEL);
  }

  // Find the index of the most recent user message
  let lastUserMessageIndex = -1;
  for (let i = sessionState.contextWindow.getLength() - 1; i >= 0; i--) {
    const content = sessionState.contextWindow.getMessages()[i].content;
    if (
      sessionState.contextWindow.getMessages()[i].role === 'user' &&
      !(
        content &&
        typeof content !== 'string' &&
        Array.isArray(content) &&
        content.some((c: LLM.Messages.ContentBlockParam) => c.type === 'tool_result')
      )
    ) {
      lastUserMessageIndex = i;
      break;
    }
  }

  // If we still need to remove tokens, target assistant messages before the most recent user message
  if (tokensRemoved < tokensToRemove) {
    const safeCutoff = Math.max(sessionState.contextWindow.getLength() - 15, 0);

    for (let i = 0; i < Math.min(safeCutoff, lastUserMessageIndex); i++) {
      if (removedIndices.has(i)) continue; // Skip if already marked for removal

      const message = sessionState.contextWindow.getMessages()[i];
      // Never remove a tool_use message without also removing its paired
      // tool_result; these are handled together in the first pass above. We
      // identify tool_use messages by scanning their content blocks.

      const containsToolUse =
        Array.isArray(message.content) &&
        message.content.some((c: LLM.Messages.ContentBlockParam) => (c as any).type === 'tool_use');

      if (message.role === 'assistant' && !containsToolUse) {
        const tokens =
          sessionState.tokenUsage.tokensByMessage.find(t => t.messageIndex === i)?.tokens || 0;

        logger?.debug(
          `Removing assistant message (index ${i}): ${JSON.stringify(message.content)}`,
          LogCategory.MODEL,
        );

        removedIndices.add(i);
        tokensRemoved += tokens;
        logger?.debug(`Removed assistant message - Tokens removed: ${tokens}`, LogCategory.MODEL);
        if (tokensRemoved >= tokensToRemove) {
          break;
        }
      }
    }
  }

  // Count remaining assistant messages not marked for removal
  let remainingAssistantCount = 0;
  for (let i = 0; i < sessionState.contextWindow.getLength(); i++) {
    if (
      !removedIndices.has(i) &&
      sessionState.contextWindow.getMessages()[i].role === 'assistant'
    ) {
      remainingAssistantCount++;
    }
  }

  // If we still need to remove tokens and have 10 or fewer assistant messages left,
  // start removing user messages (oldest first), excluding the most recent 15 messages
  if (tokensRemoved < tokensToRemove && remainingAssistantCount <= 10) {
    const safeCutoff = Math.max(sessionState.contextWindow.getLength() - 15, 0);

    for (let i = 0; i < safeCutoff; i++) {
      if (removedIndices.has(i)) continue; // Skip if already marked for removal

      const message = sessionState.contextWindow.getMessages()[i];
      if (
        message.role === 'user' &&
        !(
          message.content &&
          typeof message.content !== 'string' &&
          message.content.some((c: LLM.Messages.ContentBlockParam) => c.type === 'tool_result')
        )
      ) {
        // Not a tool result message
        const tokens =
          sessionState.tokenUsage.tokensByMessage.find(t => t.messageIndex === i)?.tokens || 0;

        logger?.debug(
          `Removing user message (index ${i}): ${JSON.stringify(message.content)}`,
          LogCategory.MODEL,
        );

        removedIndices.add(i);
        tokensRemoved += tokens;
        logger?.debug(`Removed user message - Tokens removed: ${tokens}`, LogCategory.MODEL);

        if (tokensRemoved >= tokensToRemove) {
          break;
        }
      }
    }
  }

  // If we STILL need to remove tokens and have exhausted all other options,
  // reluctantly remove from the most recent 15 messages, starting with oldest
  if (tokensRemoved < tokensToRemove) {
    const safeCutoff = Math.max(sessionState.contextWindow.getLength() - 15, 0);

    for (let i = safeCutoff; i < sessionState.contextWindow.getLength(); i++) {
      if (removedIndices.has(i)) continue; // Skip if already marked for removal

      // Prioritize assistant messages over user messages
      const msg = sessionState.contextWindow.getMessages()[i];
      const isToolUse =
        Array.isArray(msg.content) &&
        msg.content.some((c: LLM.Messages.ContentBlockParam) => (c as any).type === 'tool_use');

      if (msg.role === 'assistant' && !isToolUse) {
        const tokens =
          sessionState.tokenUsage.tokensByMessage.find(t => t.messageIndex === i)?.tokens || 0;

        logger?.debug(
          `Removing recent assistant message (index ${i}): ${JSON.stringify(sessionState.contextWindow.getMessages()[i].content)}`,
          LogCategory.MODEL,
        );

        removedIndices.add(i);
        tokensRemoved += tokens;
        logger?.debug(
          `Removed recent assistant message - Tokens removed: ${tokens}`,
          LogCategory.MODEL,
        );
        if (tokensRemoved >= tokensToRemove) {
          break;
        }
      }
    }

    // If we absolutely must, remove user messages from the most recent 15
    if (tokensRemoved < tokensToRemove) {
      for (let i = safeCutoff; i < sessionState.contextWindow.getLength(); i++) {
        if (removedIndices.has(i)) continue; // Skip if already marked for removal

        if (sessionState.contextWindow.getMessages()[i].role === 'user') {
          const tokens =
            sessionState.tokenUsage.tokensByMessage.find(t => t.messageIndex === i)?.tokens || 0;

          logger?.debug(
            `Removing recent user message (index ${i}): ${JSON.stringify(sessionState.contextWindow.getMessages()[i].content)}`,
            LogCategory.MODEL,
          );

          removedIndices.add(i);
          tokensRemoved += tokens;
          logger?.debug(
            `Removed recent user message - Tokens removed: ${tokens}`,
            LogCategory.MODEL,
          );

          if (tokensRemoved >= tokensToRemove) {
            break;
          }
        }
      }
    }
  }

  // Create new history without the removed messages
  const removedCount = removedIndices.size;

  // TODO: Replace with squashing contextWindow and resetting file tracking.
  // When we replace this we can delete the setMessages method.
  sessionState.contextWindow.setMessages(
    sessionState.contextWindow
      .getMessages()
      .filter((_: any, idx: number) => !removedIndices.has(idx)),
  );

  // Update token tracking
  const newTokensByMessage: MessageTokenUsage[] = [];
  let newTotalTokens = 0;
  const oldTotalTokens = sessionState.tokenUsage.totalTokens;

  for (let i = 0; i < sessionState.tokenUsage.tokensByMessage.length; i++) {
    if (!removedIndices.has(i)) {
      newTokensByMessage.push({
        messageIndex: newTokensByMessage.length, // Reindex
        tokens: sessionState.tokenUsage.tokensByMessage[i].tokens,
      });
      newTotalTokens += sessionState.tokenUsage.tokensByMessage[i].tokens;
    }
  }

  sessionState.tokenUsage.tokensByMessage = newTokensByMessage;
  sessionState.tokenUsage.totalTokens = newTotalTokens;

  // Add a system message to inform that history was trimmed
  if (removedIndices.size > 0) {
    sessionState.historyTrimmed = true;
    const actualTokensRemoved = oldTotalTokens - newTotalTokens;
    logger?.debug(
      `Removed ${removedCount} messages, freed up ${actualTokensRemoved} tokens`,
      LogCategory.MODEL,
    );

    // TODO: When context is trimmed/squashed, we should clear file tracking in contextWindow
    // since the files are no longer present in the context and should be re-read before editing
  }
};

// Create a default TokenManager object
const tokenManager: TokenManagerInterface = {
  manageConversationSize,
};

export { trackTokenUsage, manageConversationSize, tokenManager };
