/**
 * Thin wrapper around AgentFSM that performs side‑effects while advancing the
 * state machine. This implementation now supports both tool execution and
 * assistant replies, with abort handling.
 * @internal
 */

import {
  AgentState,
  AgentEvent,
  transition,
  isTerminal,
} from './AgentFSM.js';

import { ToolRegistry } from '../types/registry.js';
import { ModelClient, SessionState, ToolCall } from '../types/model.js';
import { PermissionManager } from '../types/permission.js';
import { ExecutionAdapter } from '../types/tool.js';
import { Logger } from '../utils/logger.js';
import { withToolCall } from '../utils/withToolCall.js';
import { ToolResultEntry } from '../types/agent.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { isTextBlock, isToolUseBlock, TextBlock } from '../types/anthropic.js';

interface DriverDeps {
  modelClient: ModelClient;
  toolRegistry: ToolRegistry;
  permissionManager: PermissionManager;
  executionAdapter: ExecutionAdapter;
  logger: Logger;
}

/** @internal */
export class FsmDriver {
  private state: AgentState = { type: 'IDLE' };
  private _iterations: number = 0;

  constructor(private readonly deps: DriverDeps) {}
  
  /**
   * The number of iterations through the FSM loop
   */
  public get iterations(): number {
    return this._iterations;
  }

  private dispatch(event: AgentEvent): void {
    this.state = transition(this.state, event);
  }

  /**
   * Runs a single user query through the FSM until it reaches a terminal
   * state. Handles both tool execution flow and direct assistant replies.
   * @returns A response object containing the assistant's text, tool results, and abort status
   */
  public async run(query: string, sessionState: SessionState): Promise<{ 
    response: string; 
    aborted: boolean;
    toolResults: ToolResultEntry[];
  }> {
    // Initialize tracking
    const toolResults: ToolResultEntry[] = [];
    let finalAssistant: Anthropic.Messages.Message | undefined;
    let currentToolCall: ToolCall | undefined;
    
    // Get quick references to dependencies and contextWindow
    const {
      modelClient,
      toolRegistry,
      permissionManager,
      executionAdapter,
      logger
    } = this.deps;
    const cw = sessionState.contextWindow;
    const abortSignal = sessionState.abortController?.signal;
    console.log(`[FsmDriver] Running with abortSignal, initial aborted=${abortSignal?.aborted}`);
    
    // If the signal is already aborted, log a warning
    if (abortSignal?.aborted) {
      console.log(`[FsmDriver] Warning: Starting run with already aborted signal!`);
    }

    // Record the user message at the very start so that the conversation
    // history always follows the canonical order: user → (tool_use →
    // tool_result)* → assistant.  If the caller has already appended the
    // message (e.g. AgentRunner does this as a convenience) we avoid adding
    // a duplicate.
    const currentMessages = cw.getMessages();
    const lastMsg = currentMessages[currentMessages.length - 1];
    const lastText = Array.isArray(lastMsg?.content) && lastMsg.content[0]?.type === 'text'
      ? (lastMsg.content[0] as TextBlock).text
      : undefined;

    if (!(lastMsg?.role === 'user' && lastText === query)) {
      cw.pushUser(query);
    }

    // USER_MESSAGE
    this.dispatch({ type: 'USER_MESSAGE' });

    // Reset iterations counter for this run
    this._iterations = 0;
    
    // FSM loop - continue until we reach a terminal state
    while (!isTerminal(this.state)) {
      // Increment iterations counter
      this._iterations++;
      
      // Check for abortion at the beginning of each loop
      if (abortSignal?.aborted) {
        console.log(`[FsmDriver] Detected aborted signal in iteration ${this._iterations}`);
        // If we have an outstanding tool_use without a matching tool_result,
        // append an aborted tool_result so the conversation remains valid.
        if (
          this.state.type === 'WAITING_FOR_TOOL_RESULT' &&
          currentToolCall &&
          sessionState.contextWindow
        ) {
          // Guard against double‑insertion in rare races
          const msgs = sessionState.contextWindow.getMessages();
          const last = msgs[msgs.length - 1];
          const alreadyHasResult =
            last &&
            Array.isArray(last.content) &&
            last.content[0]?.type === 'tool_result' &&
            last.content[0]?.tool_use_id === currentToolCall.toolUseId;

          if (!alreadyHasResult) {
            sessionState.contextWindow.pushToolResult(currentToolCall.toolUseId, { aborted: true });
            toolResults.push({
              toolId: currentToolCall.toolId,
              args: currentToolCall.args as Record<string, unknown>,
              result: { aborted: true },
              toolUseId: currentToolCall.toolUseId,
              aborted: true,
            });
          }
        }

        this.dispatch({ type: 'ABORT_REQUESTED' });
        break;
      }

      switch (this.state.type) {
        case 'WAITING_FOR_MODEL': {
          // Ask model for action
          const toolCallChat = await modelClient.getToolCall(
            query,
            toolRegistry.getToolDescriptions(),
            sessionState,
            abortSignal ? { signal: abortSignal } : undefined
          );

          // Check for abort after model call
          if (abortSignal?.aborted) {
            console.log(`[FsmDriver] Detected abort after model call, requesting abort`);
            this.dispatch({ type: 'ABORT_REQUESTED' });
            break;
          }

          if (toolCallChat.toolChosen && toolCallChat.toolCall) {
            // MODEL_TOOL_CALL path
            currentToolCall = toolCallChat.toolCall;
            
            // Add tool_use to conversation history and capture the wrapper id
            const msgId = cw.pushToolUse({
              id: currentToolCall.toolUseId,
              name: currentToolCall.toolId,
              input: currentToolCall.args as Record<string, unknown>
            });

            
            // Move to waiting for tool result
            this.dispatch({
              type: 'MODEL_TOOL_CALL',
              toolUseId: currentToolCall.toolUseId
            });
          } else {
            // MODEL_FINAL path - store the response for later return
            if (toolCallChat.response) {
              finalAssistant = toolCallChat.response;
              
              // Add assistant's response to conversation history
              if (finalAssistant.content && finalAssistant.content.length > 0) {
                cw.pushAssistant(finalAssistant.content);
              }
            }
            
            // Move to complete state
            this.dispatch({ type: 'MODEL_FINAL' });
          }
          break;
        }

        case 'WAITING_FOR_TOOL_RESULT': {
          // If the operation was aborted before the tool starts, short‑circuit
          if (abortSignal?.aborted) {
            console.log(`[FsmDriver] Detected abort before tool execution starts, short-circuiting`);
            // This block will be handled at the top‑level abort check in the
            // next loop iteration, so just continue.
            break;
          }
          if (!currentToolCall) {
            throw new Error('FsmDriver: No tool call available in WAITING_FOR_TOOL_RESULT state');
          }

          try {
            // Execute the tool with the withToolCall helper to guarantee tool_result
            await withToolCall(
              currentToolCall,
              sessionState,
              toolResults,
              (ctx) => toolRegistry.executeToolWithCallbacks(
                currentToolCall!.toolId,
                currentToolCall!.toolUseId,
                currentToolCall!.args as Record<string, unknown>,
                ctx
              ),
              {
                permissionManager,
                logger,
                executionAdapter,
                sessionState,
                toolRegistry,
                abortSignal: sessionState.abortController?.signal,
              }
            );
          } catch (error) {
            // withToolCall handles errors internally, we just need to check for abort
            if ((error as Error).message === 'AbortError') {
              console.log(`[FsmDriver] Caught AbortError from withToolCall, requesting abort`);
              this.dispatch({ type: 'ABORT_REQUESTED' });
              break;
            }
          }


          // Move to waiting for model final
          this.dispatch({ type: 'TOOL_FINISHED' });
          break;
        }

        case 'WAITING_FOR_MODEL_FINAL': {
          // Ask model for next action after tool execution
          const finalToolCallChat = await modelClient.getToolCall(
            `Based on the result of the previous tool execution, what should I do next to answer: ${query}`,
            toolRegistry.getToolDescriptions(),
            sessionState,
            abortSignal ? { signal: abortSignal } : undefined
          );

          // Check for abort after model call
          if (abortSignal?.aborted) {
            console.log(`[FsmDriver] Detected abort after model call, requesting abort`);
            this.dispatch({ type: 'ABORT_REQUESTED' });
            break;
          }

          if (finalToolCallChat.toolChosen && finalToolCallChat.toolCall) {
            // Chain another tool - return to tool execution flow
            currentToolCall = finalToolCallChat.toolCall;
            
            // Add tool_use to conversation history
            cw.pushToolUse({
              id: currentToolCall.toolUseId,
              name: currentToolCall.toolId,
              input: currentToolCall.args as Record<string, unknown>
            });
            
            // Loop back to waiting for tool result
            this.dispatch({
              type: 'MODEL_TOOL_CALL',
              toolUseId: currentToolCall.toolUseId
            });
          } else {
            // MODEL_FINAL path - store the response for later return
            if (finalToolCallChat.response) {
              finalAssistant = finalToolCallChat.response;
              
              // Add assistant's response to conversation history
              if (finalAssistant.content && finalAssistant.content.length > 0) {
                cw.pushAssistant(finalAssistant.content);
              }
            }
            
            // Move to complete state
            this.dispatch({ type: 'MODEL_FINAL' });
          }
          break;
        }
      }
    }

    // Handle the aborted state
    if (this.state.type === 'ABORTED') {
      return {
        response: "Operation aborted by user",
        aborted: true,
        toolResults
      };
    }

    // Return assistant text from all text blocks
    if (finalAssistant && finalAssistant.content && finalAssistant.content.length > 0) {
      const textBlocks = finalAssistant.content.filter(isTextBlock) as TextBlock[];
      const responseText = textBlocks
        .map(block => block.text)
        .join('');
      
      return {
        response: responseText,
        aborted: false,
        toolResults
      };
    }
    
    return {
      response: '',
      aborted: false,
      toolResults
    };
  }
}

