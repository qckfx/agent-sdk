/**
 * Agent - Main factory for creating agents
 */
import { LogLevel, createLogger } from '../utils/logger.js';
import { createContextWindow } from '../types/contextWindow.js';
import { createToolRegistry } from './ToolRegistry.js';
import { createPermissionManager } from './PermissionManager.js';
import { createModelClient } from './ModelClient.js';
import { createPromptManager } from './PromptManager.js';
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
import { createSubAgentTool } from '../tools/SubAgentTool.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
/**
 * Creates a complete agent with default tools
 * @param config - Agent configuration
 * @returns The configured agent
 */
export const createAgent = async (config) => {
    if (!config.modelProvider) {
        throw new Error('Agent requires a modelProvider function');
    }
    // Create core components
    const logger = config.logger || createLogger({ level: LogLevel.INFO });
    // Create tool registry first
    const toolRegistry = createToolRegistry();
    const permissionManager = createPermissionManager(toolRegistry, {
        uiHandler: config.permissionUIHandler
    });
    // ------------------------------------------------------------------------------------------------
    // Prompt manager selection
    // ------------------------------------------------------------------------------------------------
    let promptManager = config.promptManager;
    if (!promptManager && config.systemPrompt) {
        let promptText;
        if (typeof config.systemPrompt === 'string') {
            promptText = config.systemPrompt;
        }
        else {
            // { file: 'path/to/prompt.txt' }
            const promptPath = path.resolve(process.cwd(), config.systemPrompt.file);
            promptText = fs.readFileSync(promptPath, 'utf8');
        }
        promptManager = createPromptManager(promptText);
    }
    const modelClient = createModelClient({
        modelProvider: config.modelProvider,
        // Use either provided prompt manager or the one built from systemPrompt
        promptManager: promptManager
    });
    // -------------------------------------------------------------------
    // Register tools (built-ins and/or sub-agents) based on configuration
    // -------------------------------------------------------------------
    // Map built-in tool names to factory functions
    const builtInFactories = {
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
    const registerBuiltIn = (name) => {
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
            }
            else {
                try {
                    console.info('Creating sub-agent tool:', entry);
                    const subAgentTool = await createSubAgentTool(entry, config.getRemoteId);
                    toolRegistry.registerTool(subAgentTool);
                }
                catch (err) {
                    console.error(`Failed to register sub-agent tool from '${entry.configFile}':`, err);
                }
            }
        }
    }
    else {
        // No explicit list provided – register the full built-in set
        Object.keys(builtInFactories).forEach(registerBuiltIn);
    }
    console.info('Tool registry tools:', toolRegistry.getAllTools());
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
                let remoteId = config.remoteId;
                if (!remoteId && typeof config.getRemoteId === 'function') {
                    remoteId = await config.getRemoteId();
                }
                if (!remoteId) {
                    throw new Error('Remote environment requires a remoteId to be resolved via getRemoteId callback.');
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
            id: uuidv4(),
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
//# sourceMappingURL=Agent.js.map