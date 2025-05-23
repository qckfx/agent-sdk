/**
 * Agent - Main factory for creating agents
 */

import { Agent, AgentConfig } from '../types/main.js';
import { ModelProvider, SessionState } from '../types/model.js';
import { LogLevel, createLogger } from '../utils/logger.js';
import { createContextWindow } from '../types/contextWindow.js';
import { createToolRegistry } from './ToolRegistry.js';
import { createPermissionManager } from './PermissionManager.js';
import { createModelClient } from './ModelClient.js';
import { createDefaultPromptManager, createPromptManager } from './PromptManager.js';
import { createAgentRunner } from './AgentRunner.js';

// Execution adapters
import { LocalExecutionAdapter } from '../utils/LocalExecutionAdapter.js';
import { E2BExecutionAdapter } from '../utils/E2BExecutionAdapter.js';
import { DockerContainerManager } from '../utils/DockerContainerManager.js';
import { DockerExecutionAdapter } from '../utils/DockerExecutionAdapter.js';

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
import { isSessionAborted } from '../utils/sessionUtils.js';
/**
 * Creates a complete agent with default tools
 * @param config - Agent configuration
 * @returns The configured agent
 */
export const createAgent = async (config: AgentConfig): Promise<Agent> => {
  if (!config.modelProvider) {
    throw new Error('Agent requires a modelProvider function');
  }
  
  // Create core components
  const logger = config.logger || createLogger({ level: LogLevel.INFO });
  
  // Create tool registry first
  const toolRegistry = createToolRegistry();
  
  const permissionManager = createPermissionManager(
    toolRegistry,
    {
      uiHandler: config.permissionUIHandler
    }
  );
  
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
    promptManager: promptManager
  });
  
  // -------------------------------------------------------------------
  // Register tools (built-ins and/or sub-agents) based on configuration
  // -------------------------------------------------------------------

  // Map built-in tool names to factory functions
  const builtInFactories: Record<string, () => Tool> = {
    BashTool: createBashTool,
    GlobTool: createGlobTool,
    GrepTool: createGrepTool,
    LSTool: createLSTool,
    FileReadTool: createFileReadTool,
    FileEditTool: createFileEditTool,
    FileWriteTool: createFileWriteTool,
    ThinkTool: createThinkTool,
    BatchTool: createBatchTool,
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
    console.info('Registering tools:', config.tools);
    // Only tools listed in config are allowed
    for (const entry of config.tools) {
      console.info('Registering tool:', entry);
      if (typeof entry === 'string') {
        registerBuiltIn(entry);
      } else {
        try {
          console.info('Creating sub-agent tool:', entry);
          const subAgentTool = await createSubAgentTool(
            entry as any,
            config.getRemoteId,
          );
          toolRegistry.registerTool(subAgentTool);
        } catch (err) {
          console.error(
            `Failed to register sub-agent tool from '${(entry as any).configFile}':`,
            err
          );
        }
      }
    }
  } else {
    // No explicit list provided – register the full built-in set
    Object.keys(builtInFactories).forEach(registerBuiltIn);
  }

  console.info('Tool registry tools:', toolRegistry.getAllTools());

  const _createExecutionAdapter = async () => {
    // Select the appropriate execution adapter based on environment type
    switch (config.environment.type) {
      case 'local':
        return new LocalExecutionAdapter();
      case 'docker': {
        // Create container manager and adapter
        const containerManager = new DockerContainerManager({
          projectRoot: process.cwd(),
          logger
        });
        return new DockerExecutionAdapter(containerManager, { logger });
      }
      case 'remote': {
        let remoteId: string | undefined = (config as any).remoteId;

        if (!remoteId && typeof (config as any).getRemoteId === 'function') {
          remoteId = await (config as any).getRemoteId();
        }

        if (!remoteId) {
          throw new Error('Remote environment requires a remoteId to be resolved via getRemoteId callback.');
        }

        // Create remote execution adapter using E2B under the hood
        return await E2BExecutionAdapter.create(remoteId);
      }
      default:
        return new LocalExecutionAdapter();
    }
  }
  
  // Create the agent runner (private implementation)
  const _agentRunner = async (sessionExecutionAdapter?: ExecutionAdapter) => {
    let executionAdapter = sessionExecutionAdapter;
    
    if (!executionAdapter) {
      executionAdapter = await _createExecutionAdapter();
    }
    
    return createAgentRunner({
      modelClient,
      toolRegistry,
      permissionManager,
      logger,
      executionAdapter,
      promptManager: config.promptManager || createDefaultPromptManager()
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
    async processQuery(query, model, sessionState: SessionState = {
      id: uuidv4().toString(),
      contextWindow: createContextWindow(), 
      abortController: new AbortController(), 
      agentServiceConfig: { 
        defaultModel: '', 
        cachingEnabled: true 
      },
      llmApiKey: undefined,
    }) {
      const runner = await _agentRunner(sessionState.executionAdapter);

      if (!sessionState.abortController) {
        sessionState.abortController = new AbortController();
      } else if (sessionState.abortController.signal.aborted && !isSessionAborted(sessionState.id)) {
        // We already processed the abort, safe to refresh
        sessionState.abortController = new AbortController();
      }

      // Generate directory structure and git state maps only if they haven't been generated for this session yet
      const isDirectoryStructureGenerated = sessionState.multiRepoTracking?.directoryStructureGenerated ?? sessionState.directoryStructureGenerated ?? false;
      
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
          console.warn(`AgentService: Failed to generate multi-repo structure and git state: ${(error as Error).message}`);
        }
      }

      return runner.processQuery(query, model, sessionState);
    },
    
    /**
     * Run a simplified automated conversation (primarily used for testing)
     * @param initialQuery - The initial user query
     * @param model - The model to use for this conversation
     * @returns The conversation results
     */
    async runConversation(initialQuery, model) {
      const runner = await _agentRunner();
      return runner.runConversation(initialQuery, model);
    },
    
    registerTool(tool) {
      toolRegistry.registerTool(tool);
    },
  };
};