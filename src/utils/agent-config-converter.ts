/**
 * Converter for AgentConfigJSON to AgentConfig
 *
 * This provides conversion functions between the Zod-validated JSON config
 * and the internal AgentConfig type expected by the Agent implementation.
 */

import { CoreAgentConfig, RepositoryEnvironment } from '../types/main.js';
import { LogLevel } from '../types/logger.js';
import { TypedEventEmitter } from '../utils/TypedEventEmitter.js';
import { BusEvents } from '../types/bus-events.js';
import { AgentConfig } from '@qckfx/sdk-schema';
import { LLMFactory } from '../providers/index.js';
import { AgentCallbacks } from '../types/callbacks.js';

/**
 * A version of AgentConfig without the required properties so we can build it step by step.
 * This is for internal use only during the conversion process.
 */
type PartialAgentConfig = Partial<CoreAgentConfig>;

/**
 * Convert a Zod-validated AgentConfigJSON to the internal AgentConfig type.
 *
 * @param jsonConfig The validated JSON configuration
 * @param modelProvider The model provider to use
 * @returns A proper AgentConfig object
 */
export function convertToCoreAgentConfig(
  jsonConfig: AgentConfig,
  eventBus: TypedEventEmitter<BusEvents>,
  callbacks?: AgentCallbacks,
): CoreAgentConfig {
  // Do NOT clearSessionAborted() here - that will be done in AgentRunner after abort is handled
  // Why? Because:
  // 1. If we clear here, we'd lose the abort status that AgentRunner uses to detect aborts
  // 2. AgentRunner needs to both check and clear the status in the same critical section (try/finally)
  // 3. Clearing here would create a race condition if another abort comes in between clear and AgentRunner's check

  const modelProvider = LLMFactory.createProvider({
    model: jsonConfig.defaultModel,
    cachingEnabled: true,
  });

  // Create basic config with required properties
  const config: PartialAgentConfig = {
    modelProvider,
    environment: {
      type: jsonConfig.environment as RepositoryEnvironment['type'],
    } as RepositoryEnvironment,
    cachingEnabled: true,
    eventBus,
  };

  // Add optional properties if they exist
  if (jsonConfig.defaultModel !== undefined) {
    config.defaultModel = jsonConfig.defaultModel;
  }

  if (jsonConfig.systemPrompt !== undefined) {
    config.systemPrompt = jsonConfig.systemPrompt;
  }

  if (jsonConfig.logLevel !== undefined) {
    // jsonConfig.logLevel is validated by the schema; cast to LogLevel for internal use
    config.logLevel = jsonConfig.logLevel as unknown as LogLevel;
  }

  if (jsonConfig.tools !== undefined) {
    config.tools = jsonConfig.tools;
  }

  if (callbacks?.getRemoteId && typeof callbacks.getRemoteId === 'function') {
    config.getRemoteId = callbacks.getRemoteId;
  }

  if (callbacks?.onPermissionRequested && typeof callbacks.onPermissionRequested === 'function') {
    config.permissionUIHandler = {
      requestPermission: async (
        sessionId: string,
        toolId: string,
        args: Record<string, unknown>,
      ) => {
        return await callbacks.onPermissionRequested!({
          sessionId,
          toolId,
          args,
        });
      },
    };
  }

  return config as CoreAgentConfig;
}
