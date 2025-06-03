/**
 * @deprecated AgentRunner has been merged into AgentEngine.  This thin shim
 * exists only to avoid immediate breaking changes in downstream code and the
 * internal test-suite.  New code should instantiate `AgentEngine` directly.
 */

import type { AgentRunner, AgentRunnerConfig, ProcessQueryResult } from '../types/agent.js';
import type { SessionState } from '../types/model.js';

import { createDefaultPromptManager } from './PromptManager.js';

import { LogCategory, createLogger, LogLevel } from '../utils/logger.js';

import { FsmDriver } from './FsmDriver.js';
import { isSessionAborted, clearSessionAborted } from '../utils/sessionUtils.js';
import { attachCheckpointSync } from '../utils/CheckpointSync.js';

import { BusEvent } from '../types/bus-events.js';

/**
 * Drop-in compatible shim that exposes the historical `createAgentRunner`
 * signature but internally runs the exact same FSM logic that now lives in
 * AgentEngine.  All stateful collaborators are supplied by the caller via the
 * config object just like before.
 */
export function createAgentRunner(config: AgentRunnerConfig): AgentRunner {
  const {
    modelClient,
    toolRegistry,
    permissionManager,
    executionAdapter,
    promptManager = createDefaultPromptManager(),
    eventBus,
    logger,
  } = config;

  return {
    executionAdapter,
    promptManager,

    async processQuery(
      query: string,
      model: string,
      sessionState: SessionState,
    ): Promise<ProcessQueryResult> {
      const sessionId = sessionState.id as string;

      // Guard against missing sessionId
      if (!sessionId) {
        logger.error(
          'Cannot process query: Missing sessionId in session state',
          LogCategory.SYSTEM,
        );
        return {
          error: 'Missing sessionId in session state',
          contextWindow: sessionState.contextWindow,
          done: true,
          aborted: false,
        };
      }

      if (isSessionAborted(sessionState)) {
        logger.info(`Session ${sessionId} is aborted, skipping FSM execution`, LogCategory.SYSTEM);
        return {
          aborted: true,
          done: true,
          contextWindow: sessionState.contextWindow,
          response: 'Operation aborted by user',
        };
      }

      attachCheckpointSync(sessionState);

      if (
        sessionState.contextWindow.getLength() === 0 ||
        sessionState.contextWindow.getMessages()[sessionState.contextWindow.getLength() - 1]
          .role !== 'user'
      ) {
        sessionState.contextWindow.pushUser(query);
      }

      try {
        const driver = new FsmDriver({
          modelClient,
          toolRegistry,
          permissionManager,
          executionAdapter,
          logger,
        });

        const {
          response: driverResponse,
          toolResults,
          aborted,
        } = await driver.run(query, sessionState, model);

        let response: string | undefined = driverResponse;

        if (aborted) {
          const skipAck = sessionState.skipAbortAck === true;

          const msgs = sessionState.contextWindow.getMessages();
          const last = msgs[msgs.length - 1];
          if (!skipAck && (!last || last.role !== 'assistant')) {
            sessionState.contextWindow.pushAssistant([
              { type: 'text', text: 'Operation aborted by user' },
            ]);
          }

          if (skipAck) {
            response = undefined;
          }

          clearSessionAborted(sessionState);
          sessionState.abortController = new AbortController();

          if (sessionState.skipAbortAck) {
            delete sessionState.skipAbortAck;
          }
          logger.info('Cleared abort status after handling abort in FSM', LogCategory.SYSTEM);
        }

        eventBus.emit(BusEvent.PROCESSING_COMPLETED, { sessionId, response: response || '' });

        return {
          contextWindow: sessionState.contextWindow,
          response,
          done: true,
          aborted,
          result: {
            toolResults,
            iterations: driver.iterations,
          },
        };
      } catch (err) {
        logger.error('Error in processQuery:', err as Error, LogCategory.SYSTEM);
        return {
          error: (err as Error).message,
          contextWindow: sessionState.contextWindow,
          done: true,
          aborted: isSessionAborted(sessionState),
        };
      }
    },
  };
}
