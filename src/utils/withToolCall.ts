import { ToolCall, SessionState } from '../types/model.js';
import { ToolResultEntry } from '../types/agent.js';
import { ToolContext } from '../types/tool.js';
import { ToolResult, LastToolError } from '../types/tool-result.js';
import { LogCategory } from '../types/logger.js';

/**
 * Executes a tool call and guarantees that a matching `tool_result` block is
 * added to the conversation history – even on error or abort.
 *
 * It also appends an entry to the in‑memory `toolResults` array that the
 * AgentRunner uses for its cumulative result.
 */
export async function withToolCall(
  toolCall: ToolCall,
  sessionState: SessionState,
  toolResults: ToolResultEntry[],
  exec: (ctx: ToolContext) => Promise<ToolResult>,
  context: ToolContext,
): Promise<unknown> {
  context.logger?.debug(
    `[withToolCall] Executing tool ${toolCall.toolId}, abortSignal=${context.abortSignal?.aborted}`,
    LogCategory.TOOLS,
  );
  let result: unknown;
  let aborted = false;

  try {
    try {
      const execPromise = exec(context);

      // If an abortSignal is provided, race the execution against it so we can
      // resolve promptly when the caller aborts – even if the underlying tool
      // ignores the signal.
      if (context.abortSignal) {
        result = await Promise.race([
          execPromise,
          new Promise<unknown>((_, reject) => {
            const onAbort = () => {
              context.logger?.debug(
                `[withToolCall] AbortSignal 'abort' event received`,
                LogCategory.TOOLS,
              );
              context.abortSignal!.removeEventListener('abort', onAbort);
              reject(new Error('AbortError'));
            };
            if (context.abortSignal!.aborted) {
              context.logger?.debug(
                `[withToolCall] AbortSignal was already aborted when Promise.race started`,
                LogCategory.TOOLS,
              );
              return onAbort();
            }
            context.abortSignal!.addEventListener('abort', onAbort);
          }),
        ]);
      } else {
        result = await execPromise;
      }
    } catch (err) {
      if ((err as Error).message === 'AbortError') {
        context.logger?.debug(
          `[withToolCall] Caught AbortError, marking result as aborted`,
          LogCategory.TOOLS,
        );
        aborted = true;
        // Surface a simple aborted marker so tests (and callers) can detect it
        result = { aborted: true };
      } else {
        result = { error: String(err) };
      }
    }

    // --------------------------------------------------------------
    // Check if tool returned a typed error and set lastToolError
    // --------------------------------------------------------------
    if (result && typeof result === 'object' && 'ok' in result) {
      const toolResult = result as ToolResult;
      if (!toolResult.ok) {
        sessionState.lastToolError = {
          toolId: toolCall.toolId,
          error: toolResult.error,
          args: toolCall.args as Record<string, unknown>,
        };
      } else {
        // Clear previous error on success
        delete sessionState.lastToolError;
      }
    }

    // --------------------------------------------------------------
    // Decide whether we should append the `tool_result` message.  If
    // a rollback occurred while the tool was executing the accompanying
    // `tool_use` message may have been removed from the ContextWindow.
    // Adding a result in that case would break the required ordering
    // (tool_use must be immediately followed by the corresponding
    // tool_result).
    // --------------------------------------------------------------

    let shouldAppendResult = true;

    if (toolCall.toolUseId) {
      const lastMsg = sessionState.contextWindow.peek();
      const firstBlock = Array.isArray(lastMsg?.anthropic.content)
        ? (lastMsg!.anthropic.content[0] as any)
        : undefined;

      const stillHasToolUse =
        firstBlock?.type === 'tool_use' && firstBlock.id === toolCall.toolUseId;

      if (stillHasToolUse) {
        sessionState.contextWindow.pushToolResult(toolCall.toolUseId, result);
      } else {
        // ContextWindow has been rolled back – skip appending the result.
        context.logger?.warn(
          `[withToolCall] Skipping tool_result for toolUseId=${toolCall.toolUseId} because context was rolled back`,
        );
        shouldAppendResult = false;
      }
    }

    if (shouldAppendResult) {
      toolResults.push({
        toolId: toolCall.toolId,
        args: toolCall.args as Record<string, unknown>,
        result,
        toolUseId: toolCall.toolUseId,
        aborted,
      });
    }

    if (aborted) throw new Error('AbortError');

    return result;
  } catch (e) {
    throw e;
  }
}
