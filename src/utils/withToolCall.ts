import { ToolCall, SessionState } from '../types/model.js';
import { ToolResultEntry } from '../types/agent.js';
import { ToolContext } from '../types/tool.js';

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
  exec: (ctx: ToolContext) => Promise<unknown>,
  context: ToolContext,
): Promise<unknown> {
  console.log(`[withToolCall] Executing tool ${toolCall.toolId}, abortSignal=${context.abortSignal?.aborted}`);
  let result: unknown;
  let aborted = false;

  // Set the current tool execution ID and store the previous one
  const prev = context.sessionState.currentToolExecutionId;
  context.sessionState.currentToolExecutionId = 
       context.sessionState.generateNewToolExecutionId();
  
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
              console.log(`[withToolCall] AbortSignal 'abort' event received`);
              context.abortSignal!.removeEventListener('abort', onAbort);
              reject(new Error('AbortError'));
            };
            if (context.abortSignal!.aborted) {
              console.log(`[withToolCall] AbortSignal was already aborted when Promise.race started`);
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
        console.log(`[withToolCall] Caught AbortError, marking result as aborted`);
        aborted = true;
        // Surface a simple aborted marker so tests (and callers) can detect it
        result = { aborted: true };
      } else {
        result = { error: String(err) };
      }
    }

    // Always append tool_result to conversation history.
    if (sessionState.contextWindow && toolCall.toolUseId) {
      sessionState.contextWindow.pushToolResult(toolCall.toolUseId, result);
    }

    toolResults.push({
      toolId: toolCall.toolId,
      args: toolCall.args as Record<string, unknown>,
      result,
      toolUseId: toolCall.toolUseId,
      aborted,
    });

    if (aborted) throw new Error('AbortError');

    return result;
  } finally {
    // Restore the previous tool execution ID
    context.sessionState.currentToolExecutionId = prev;
  }
}