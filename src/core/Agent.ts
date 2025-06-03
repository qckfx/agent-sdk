/**
 * Agent - Main factory for creating agents
 */

import { Agent, CoreAgentConfig } from '../types/main.js';
import { ModelProvider, SessionState } from '../types/model.js';
import { LogLevel, createLogger, LogCategory } from '../utils/logger.js';
import { ContextWindow, createContextWindow } from '../types/contextWindow.js';
import { createToolRegistry } from './ToolRegistry.js';
import { createPermissionManager } from './PermissionManager.js';
import { createModelClient } from './ModelClient.js';
import { createDefaultPromptManager, createPromptManager } from './PromptManager.js';
import { createAgentRunner } from './AgentRunner.js';

// Default tools
import { createBashTool } from '../tools/BashTool.js';
import { createGlobTool } from '../tools/GlobTool.js';
import { createGrepTool } from '../tools/GrepTool.js';
import { createLSTool } from '../tools/LSTool.js';
import { createFileReadTool } from '../tools/FileReadTool.js';
import { createFileEditTool } from '../tools/FileEditTool.js';
import { createFileWriteTool } from '../tools/FileWriteTool.js';
import { createThinkTool } from '../tools/ThinkTool.js';
import { createBatchTool } from '../tools/BatchTool.js';
import { ExecutionAdapter, Tool } from '../types/tool.js';
import { createSubAgentTool } from '../tools/SubAgentTool.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createExecutionAdapter } from '../utils/ExecutionAdapterFactory.js';

/**
 * Creates a complete agent with default tools
 * @param config - Agent configuration
 * @returns The configured agent
 */
export const createAgent = async (config: CoreAgentConfig, sessionId: string): Promise<Agent> => {
  if (!config.modelProvider) {
    throw new Error('Agent requires a modelProvider function');
  }

  // Create core components
  const logger =
    config.logger ??
    createLogger({ level: config.logLevel ?? LogLevel.INFO, sessionId: sessionId });

  // Create tool registry first (propagate logger)
  const toolRegistry = createToolRegistry(logger);

  const permissionManager = createPermissionManager(toolRegistry, {
    uiHandler: config.permissionUIHandler,
  });

  // ------------------------------------------------------------------------------------------------
  // Prompt manager selection
  // ------------------------------------------------------------------------------------------------

  let promptManager = config.promptManager;

  if (!promptManager && config.systemPrompt) {
    let promptText: string;

    if (typeof config.systemPrompt === 'string') {
      promptText = config.systemPrompt;
    } else {
      // { file: 'path/to/prompt.txt' }
      const promptPath = path.resolve(process.cwd(), config.systemPrompt.file);
      promptText = fs.readFileSync(promptPath, 'utf8');
    }

    promptManager = createPromptManager(promptText);
  }

  const modelClient = createModelClient({
    modelProvider: config.modelProvider as ModelProvider,
    // Use either provided prompt manager or the one built from systemPrompt
    promptManager: promptManager,
    logger: logger,
  });

  // -------------------------------------------------------------------
  // Register tools (built-ins and/or sub-agents) based on configuration
  // -------------------------------------------------------------------

  // Map built-in tool names to factory functions
  const builtInFactories: Record<string, () => Tool> = {
    bash: createBashTool,
    glob: createGlobTool,
    grep: createGrepTool,
    ls: createLSTool,
    file_read: createFileReadTool,
    file_edit: createFileEditTool,
    file_write: createFileWriteTool,
    think: createThinkTool,
    batch: createBatchTool,
  };

  const registerBuiltIn = (name: string): void => {
    const factory = builtInFactories[name];
    if (!factory) {
      logger.warn(`Unknown built-in tool '${name}' requested in agent config`);
      return;
    }
    toolRegistry.registerTool(factory());
  };

  if (Array.isArray(config.tools) && config.tools.length > 0) {
    logger.info('Registering tools', LogCategory.TOOLS, config.tools);
    // Only tools listed in config are allowed
    for (const entry of config.tools) {
      logger.info('Registering tool', LogCategory.TOOLS, entry);
      if (typeof entry === 'string') {
        registerBuiltIn(entry);
      } else {
        try {
          logger.debug('Creating sub-agent tool', LogCategory.TOOLS, entry);
          const subAgentTool = await createSubAgentTool(entry as any, config.getRemoteId, logger);
          toolRegistry.registerTool(subAgentTool);
        } catch (err) {
          logger.error(
            `Failed to register sub-agent tool from '${(entry as any).configFile}'`,
            err as Error,
            LogCategory.TOOLS,
          );
        }
      }
    }
  } else {
    // No explicit list provided – register the full built-in set
    Object.keys(builtInFactories).forEach(registerBuiltIn);
  }

  logger.debug('Tool registry tools', LogCategory.TOOLS, toolRegistry.getAllTools());

  // Create the agent runner (private implementation)
  const _agentRunner = async (sessionId: string, sessionExecutionAdapter?: ExecutionAdapter) => {
    let executionAdapter = sessionExecutionAdapter;

    if (!executionAdapter) {
      if (config.environment.type === 'remote') {
        // Remote execution requires a getRemoteId callback provided by the
        // host application.  This is used to resolve the sandbox/container
        // identifier where commands will be executed.
        if (typeof config.getRemoteId !== 'function') {
          throw new Error('Remote environment requires a getRemoteId callback.');
        }

        const remoteId = await config.getRemoteId(sessionId);

        const { adapter } = await createExecutionAdapter({
          sessionId,
          eventBus: config.eventBus,
          type: 'remote',
          logger: config.logger,
          projectsRoot: '/home/user/projects',
          remote: {
            sandboxId: remoteId,
            projectsRoot: '/home/user/projects',
          },
          autoFallback: false,
        });

        executionAdapter = adapter;
      } else {
        // Local environment
        const { adapter } = await createExecutionAdapter({
          sessionId,
          eventBus: config.eventBus,
          type: config.environment.type,
          logger: config.logger,
          projectsRoot: process.cwd(),
          autoFallback: true,
        });

        executionAdapter = adapter;
      }
    }

    return createAgentRunner({
      modelClient,
      toolRegistry,
      permissionManager,
      logger,
      eventBus: config.eventBus,
      executionAdapter,
      promptManager: config.promptManager || createDefaultPromptManager(),
    });
  };

  // Return the complete agent interface
  return {
    // Core components
    toolRegistry,
    permissionManager,
    modelClient,
    environment: config.environment,
    logger,

    // Helper methods
    async processQuery(query, model, sessionState: SessionState) {
      const runner = await _agentRunner(sessionState.id, sessionState.executionAdapter);

      // Generate directory structure and git state maps only if they haven't been generated for this session yet
      const isDirectoryStructureGenerated =
        sessionState.multiRepoTracking?.directoryStructureGenerated ??
        sessionState.directoryStructureGenerated ??
        false;

      if (!isDirectoryStructureGenerated) {
        try {
          // Get directory structures for all repositories
          const directoryStructures = await runner.executionAdapter.getDirectoryStructures();

          // Get git repository information for all repositories
          const gitRepos = await runner.executionAdapter.getGitRepositoryInfo();

          // Set multi-repo directory structures and git states in the prompt manager
          runner.promptManager.setMultiRepoDirectoryStructures(directoryStructures);
          runner.promptManager.setMultiRepoGitStates(gitRepos);

          // Initialize/update multi-repo tracking
          const repoPaths = Array.from(directoryStructures.keys());
          sessionState.multiRepoTracking = {
            repoCount: repoPaths.length,
            repoPaths,
            directoryStructureGenerated: true,
            lastCheckpointMetadata: sessionState.multiRepoTracking?.lastCheckpointMetadata,
          };

          // Mark that we've generated directory structure for this session (backwards compatibility)
          sessionState.directoryStructureGenerated = true;
        } catch (error) {
          console.warn(
            `AgentService: Failed to generate multi-repo structure and git state: ${(error as Error).message}`,
          );
        }
      }

      return runner.processQuery(query, model, sessionState);
    },

    registerTool(tool) {
      toolRegistry.registerTool(tool);
    },
  };
};

export const createSessionState = async (
  config: CoreAgentConfig,
  sessionId?: string,
  contextWindow?: ContextWindow,
): Promise<SessionState> => {
  const sid = sessionId ?? uuidv4().toString();
  const remoteId =
    config.environment.type === 'remote' ? await config.getRemoteId!(sid) : undefined;
  const { adapter } = await createExecutionAdapter({
    sessionId: sid,
    type: config.environment.type,
    logger: config.logger,
    eventBus: config.eventBus,
    projectsRoot: config.environment.type === 'remote' ? '/home/user/projects' : process.cwd(),
    autoFallback: false,
  });

  return {
    id: sid,
    contextWindow: contextWindow ?? createContextWindow(),
    abortController: new AbortController(),
    agentServiceConfig: {
      defaultModel: config.defaultModel,
      cachingEnabled: config.cachingEnabled ?? true,
    },
    aborted: false,
    remoteId: remoteId,
    executionAdapter: adapter,
  };
};
