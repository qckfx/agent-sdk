/**
 * Agent - Main factory for creating agents
 */

import { Agent, AgentConfig } from '../types/main.js';
import { ModelProvider } from '../types/model.js';
import { LogLevel, createLogger } from '../utils/logger.js';
import { createContextWindow } from '../types/contextWindow.js';
import { createToolRegistry } from './ToolRegistry.js';
import { createPermissionManager } from './PermissionManager.js';
import { createModelClient } from './ModelClient.js';
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
import { Tool } from '../types/tool.js';

/**
 * Creates a complete agent with default tools
 * @param config - Agent configuration
 * @returns The configured agent
 */
export const createAgent = (config: AgentConfig): Agent => {
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
  
  const modelClient = createModelClient({
    modelProvider: config.modelProvider as ModelProvider,
    promptManager: config.promptManager
  });
  
  // Create and register default tools
  const tools: Tool[] = [
    createBashTool(),
    createGlobTool(),
    createGrepTool(),
    createLSTool(),
    createFileReadTool(),
    createFileEditTool(),
    createFileWriteTool(),
    createThinkTool(),
    createBatchTool()
  ];
  
  tools.forEach(tool => toolRegistry.registerTool(tool));
  
  // Create the agent runner (private implementation)
  const _agentRunner = async () => {
    let executionAdapter;
    
    console.log(`Creating agent runner with environment type ${config.environment.type}`);
    // Select the appropriate execution adapter based on environment type
    switch (config.environment.type) {
      case 'local':
        executionAdapter = new LocalExecutionAdapter();
        break;
      case 'docker': {
        // Create container manager and adapter
        const containerManager = new DockerContainerManager({
          projectRoot: process.cwd(),
          logger
        });
        executionAdapter = new DockerExecutionAdapter(containerManager, { logger });
        break;
      }
      case 'remote': {
        // Check for remote ID from callback or environment variable
        const remoteId = process.env.REMOTE_ID;

        if (!remoteId) {
          throw new Error(
            'Remote environment requires REMOTE_ID environment variable'
          );
        }

        // Create remote execution adapter using E2B under the hood
        executionAdapter = await E2BExecutionAdapter.create(remoteId);
        break;
      }
      default:
        executionAdapter = new LocalExecutionAdapter();
    }
    
    return createAgentRunner({
      modelClient,
      toolRegistry,
      permissionManager,
      logger,
      executionAdapter,
      promptManager: config.promptManager
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
    async processQuery(query, model, sessionState = { 
      contextWindow: createContextWindow(), 
      abortController: new AbortController(), 
      agentServiceConfig: { 
        defaultModel: '', 
        permissionMode: 'interactive', 
        allowedTools: [], 
        cachingEnabled: true 
      },
      llmApiKey: undefined,
    }) {
      const runner = await _agentRunner();
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