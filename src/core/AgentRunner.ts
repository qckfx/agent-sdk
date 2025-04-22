/**
 * AgentRunner - Orchestrates the entire agent process
 */

import { 
  AgentRunner, 
  AgentRunnerConfig, 
  ConversationResult, 
  ProcessQueryResult, 
} from '../types/agent.js';
import { SessionState } from '../types/model.js';
import { LogCategory, createLogger, LogLevel } from '../utils/logger.js';

import { 
  isSessionAborted, 
  clearSessionAborted, 
  AgentEvents, 
  AgentEventType 
} from '../utils/sessionUtils.js';
import { FsmDriver } from './FsmDriver.js';
import { createContextWindow } from '../types/contextWindow.js';

/**
 * Creates an agent runner to orchestrate the agent process
 * @param config - Configuration options
 * @returns The agent runner interface
 * @internal
 */
export function createAgentRunner(config: AgentRunnerConfig): AgentRunner {
  // Listen for abort events just for logging purposes
  AgentEvents.on(
    AgentEventType.ABORT_SESSION,
    (sessionId: string) => {
      console.log(`AgentRunner received abort event for session: ${sessionId}`);
    }
  );
  // Validate required dependencies
  if (!config.modelClient) throw new Error('AgentRunner requires a modelClient');
  if (!config.toolRegistry) throw new Error('AgentRunner requires a toolRegistry');
  if (!config.permissionManager) throw new Error('AgentRunner requires a permissionManager');
  if (!config.executionAdapter) throw new Error('AgentRunner requires an executionAdapter');
  // Dependencies
  const modelClient = config.modelClient;
  const toolRegistry = config.toolRegistry;
  const permissionManager = config.permissionManager;
  const executionAdapter = config.executionAdapter;
  const logger = config.logger || createLogger({
    level: LogLevel.DEBUG,
    prefix: 'AgentRunner'
  });
  
  // Return the public interface
  return {
    /**
     * Process a user query
     * @param query - The user's query
     * @param sessionState - Current session state 
     * @returns The result of processing the query
     * 
     * NOTE: The query is always appended to the end of the conversation 
     * history before this call is made.
     */
    async processQuery(query: string, sessionState: SessionState): Promise<ProcessQueryResult> {
      const sessionId = sessionState.id as string;
      
      // Validate sessionId
      if (!sessionId) {
        logger.error('Cannot process query: Missing sessionId in session state', LogCategory.SYSTEM);
        return {
          error: 'Missing sessionId in session state',
          sessionState,
          done: true,
          aborted: false
        };
      }
      
      // Check if the session is already aborted - short-circuit if it is
      if (isSessionAborted(sessionId)) {
        logger.info(`Session ${sessionId} is aborted, skipping FSM execution`, LogCategory.SYSTEM);
        try {
          return {
            aborted: true,
            done: true,
            sessionState,
            response: "Operation aborted by user"
          };
        } finally {
          // Always clear abort status and refresh the AbortController
          clearSessionAborted(sessionId);
          sessionState.abortController = new AbortController();
          logger.info(`Cleared abort status for short-circuit path`, LogCategory.SYSTEM);
        }
      }
      
      // Make sure we have an AbortController
      if (!sessionState.abortController) {
        // Create a new AbortController in the sessionState
        sessionState.abortController = new AbortController();
        console.log(`[AgentRunner] Created new AbortController for session ${sessionId}`);
      }
      
      // Add user message to conversation history if needed
      if (sessionState.contextWindow.getLength() === 0 || 
          sessionState.contextWindow.getMessages()[sessionState.contextWindow.getLength() - 1].role !== 'user') {
        sessionState.contextWindow.pushUser(query);
      }
      
      try {
        // Create a logger for the FSM driver
        const fsmLogger = createLogger({
          level: LogLevel.DEBUG,
          prefix: 'FsmDriver'
        });
        
        // Create the finite state machine driver
        const driver = new FsmDriver({ 
          modelClient, 
          toolRegistry,
          permissionManager,
          executionAdapter,
          logger: fsmLogger
        });
        
        // Run the query through the FSM
        const { response, toolResults, aborted } = await driver.run(query, sessionState);
        
        // If the operation was aborted we need to do two things:
        //   1. Make sure the conversation history is well‑formed by appending
        //      an assistant acknowledgement.  The previous message will be
        //      the `tool_result` (a user‑role message).  Without this
        //      additional assistant message the next user query appears
        //      immediately after a user message, which frequently causes the
        //      language model to continue the interrupted tool flow instead
        //      of responding to the new request.
        //   2. Clear the abort status and swap in a fresh AbortController so
        //      subsequent requests can proceed normally.
        if (aborted) {
          const msgs = sessionState.contextWindow.getMessages();
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== 'assistant') {
            sessionState.contextWindow.pushAssistant([
              { type: 'text', text: 'Operation aborted by user' },
            ]);
          }

          // We've honoured the abort request – reset the session‑level flag
          // and prepare for the next interaction.
          clearSessionAborted(sessionId);  // We've honored the abort request
          // Create a new AbortController for the next message
          sessionState.abortController = new AbortController();
          logger.info(`Cleared abort status after handling abort in FSM`, LogCategory.SYSTEM);
        }

        // Emit an event to signal processing is completed - will be captured by WebSocketService
        AgentEvents.emit(AgentEventType.PROCESSING_COMPLETED, {
          sessionId,
          response
        });
        
        // Return the result
        return {
          sessionState,
          response,
          done: true,
          aborted,
          result: { 
            toolResults, 
            iterations: driver.iterations 
          }
        };
      } catch (error: unknown) {
        logger.error('Error in processQuery:', error, LogCategory.SYSTEM);
        
        return {
          error: (error as Error).message,
          sessionState,
          done: true,
          aborted: isSessionAborted(sessionId)
        };
      }
    },
    
    /**
     * Run a conversation loop until completion
     * @param initialQuery - The initial user query
     * @returns The final result
     */
    async runConversation(initialQuery: string): Promise<ConversationResult> {
      let query = initialQuery;
      let sessionState: Record<string, unknown> = { contextWindow: createContextWindow() };
      let done = false;
      const responses: string[] = [];
      
      while (!done) {
        const result = await this.processQuery(query, sessionState);
        
        if (result.error) {
          logger.error('Error in conversation:', result.error, LogCategory.SYSTEM);
          responses.push(`Error: ${result.error}`);
          break;
        }
        
        if (result.response) {
          responses.push(result.response);
        }
        
        sessionState = result.sessionState;
        done = result.done;
        
        // If not done, we would get the next user query here
        if (!done) {
          query = 'Continue'; // For automated runs
        }
      }
      
      return {
        responses,
        sessionState
      };
    },
  };
}

