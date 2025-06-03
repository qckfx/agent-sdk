/**
 * New AgentEngine – unified factory + orchestrator
 *
 * Phase-1 implementation:  takes over all responsibilities previously held by
 * `core/Agent.ts` (factory) while still relying on the legacy
 * `createAgentRunner` helper for per-request orchestration.  In a subsequent
 * phase we will inline the FSM runner logic and delete AgentRunner
 * altogether.
 */

import path from 'path';
import fs from 'fs';

import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Type imports – kept local to avoid circular public exports
// ---------------------------------------------------------------------------

import type { Agent, CoreAgentConfig } from '../types/main.js';

import type { SessionState, ModelProvider } from '../types/model.js';
import type { Tool, ExecutionAdapter } from '../types/tool.js';
import type { ToolRegistry } from '../types/registry.js';
import type { PermissionManager } from '../types/permission.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

import { createLogger, LogLevel, LogCategory, type Logger } from '../utils/logger.js';

import { createToolRegistry } from './ToolRegistry.js';
import { createPermissionManager } from './PermissionManager.js';
import { createModelClient } from './ModelClient.js';

import { createDefaultPromptManager, createPromptManager, PromptManager } from './PromptManager.js';

// The legacy AgentRunner orchestrator has been subsumed – we now inline the
// relevant logic directly.  Only the finite-state-machine driver remains as a
// separate class.

import { FsmDriver } from './FsmDriver.js';

import { isSessionAborted, clearSessionAborted } from '../utils/sessionUtils.js';

import { attachCheckpointSync } from '../utils/CheckpointSync.js';

import { createExecutionAdapter } from '../utils/ExecutionAdapterFactory.js';

// Built-in tool factories ----------------------------------------------------
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

import { ContextWindow, createContextWindow } from '../types/contextWindow.js';

// Events / bus --------------------------------------------------------------
import { TypedEventEmitter } from '../utils/TypedEventEmitter.js';
import { BusEvents, BusEvent } from '../types/bus-events.js';

/**
 * `AgentEngine` composes all long-lived collaborators (tool registry, model
 * client, permission manager, …) exactly once per Agent instance.  For each
 * incoming user query it lazily constructs an *ephemeral* "runner" that
 * drives the finite-state-machine interaction with the LLM.  Today that
 * runner is delegated to `createAgentRunner`; later we will inline the logic.
 */
export class AgentEngine implements Agent {
  // -----------------------------------------------------------------------
  // Static factory – performs all async work
  // -----------------------------------------------------------------------

  static async create(config: CoreAgentConfig, sessionId: string): Promise<AgentEngine> {
    if (!config.modelProvider) {
      throw new Error('AgentEngine requires a "modelProvider" function');
    }

    // ----------------------------------------------------------
    // Logger (may rely on session id for correlation)
    // ----------------------------------------------------------
    const logger =
      config.logger ?? createLogger({ level: config.logLevel ?? LogLevel.INFO, sessionId });

    // ----------------------------------------------------------
    // Core singletons that live for the whole agent life-time
    // ----------------------------------------------------------

    // 1) Tool registry and permission manager
    const toolRegistry = createToolRegistry(logger);

    const permissionManager = createPermissionManager(toolRegistry, {
      uiHandler: config.permissionUIHandler,
    });

    // 2) Prompt manager – honour inline string OR { file: "…" }
    let promptManager = config.promptManager as PromptManager | undefined;
    if (!promptManager && config.systemPrompt) {
      const promptText =
        typeof config.systemPrompt === 'string'
          ? config.systemPrompt
          : fs.readFileSync(path.resolve(process.cwd(), config.systemPrompt.file), 'utf8');
      promptManager = createPromptManager(promptText);
    }

    // 3) Model client (wraps the provided LLM provider)
    const modelClient = createModelClient({
      modelProvider: config.modelProvider as ModelProvider,
      promptManager,
      logger,
    });

    // ----------------------------------------------------------
    // Register built-in tools / sub-agents as per configuration
    // ----------------------------------------------------------

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
      for (const entry of config.tools) {
        if (typeof entry === 'string') {
          registerBuiltIn(entry);
        } else {
          try {
            const subAgentTool = await createSubAgentTool(entry as any, config.getRemoteId);
            toolRegistry.registerTool(subAgentTool);
          } catch (err) {
            logger.error(
              `Failed to register sub-agent tool from '${(entry as any).configFile}':`,
              err as Error,
            );
          }
        }
      }
    } else {
      // No explicit list – register full built-in set
      Object.keys(builtInFactories).forEach(registerBuiltIn);
    }

    // Expose engine instance
    return new AgentEngine({
      config,
      logger,
      toolRegistry,
      permissionManager,
      modelClient,
    });
  }

  // -----------------------------------------------------------------------
  // Construction helpers
  // -----------------------------------------------------------------------

  private constructor(args: {
    config: CoreAgentConfig;
    logger: Logger;
    toolRegistry: ToolRegistry;
    permissionManager: PermissionManager;
    modelClient: ReturnType<typeof createModelClient>;
  }) {
    this._config = args.config;
    this._logger = args.logger;
    this._toolRegistry = args.toolRegistry;
    this._permissionManager = args.permissionManager;
    this._modelClient = args.modelClient;
  }

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  private readonly _config: CoreAgentConfig;
  private readonly _logger: Logger;
  private readonly _toolRegistry: ToolRegistry;
  private readonly _permissionManager: PermissionManager;
  private readonly _modelClient: ReturnType<typeof createModelClient>;

  // -----------------------------------------------------------------------
  // Public read-only accessors (part of Agent interface)
  // -----------------------------------------------------------------------

  get toolRegistry() {
    return this._toolRegistry;
  }

  get permissionManager() {
    return this._permissionManager;
  }

  get modelClient() {
    return this._modelClient;
  }

  get environment() {
    return this._config.environment;
  }

  get logger(): Logger {
    return this._logger;
  }

  // -----------------------------------------------------------------------
  // Core behaviour – user entry-point
  // -----------------------------------------------------------------------

  /**
   * Process a user query.  Lazily constructs an AgentRunner (for now) that
   * owns one interaction with the FSM.
   */
  async processQuery(query: string, model: string, sessionState: SessionState) {
    // Ensure an execution adapter is present for this session.
    const executionAdapter = await this._ensureExecutionAdapter(sessionState);

    // -------------------------------------------------------------------
    // Multi-repo directory & git state initialisation (copied verbatim from
    // legacy createAgent implementation)
    // -------------------------------------------------------------------

    const isDirectoryStructureGenerated =
      sessionState.multiRepoTracking?.directoryStructureGenerated ??
      sessionState.directoryStructureGenerated ??
      false;

    if (!isDirectoryStructureGenerated) {
      try {
        const directoryStructures = await executionAdapter.getDirectoryStructures();
        const gitRepos = await executionAdapter.getGitRepositoryInfo();

        // The prompt manager lives on the engine, not the adapter.
        (
          this._config.promptManager || createDefaultPromptManager()
        ).setMultiRepoDirectoryStructures(directoryStructures);
        (this._config.promptManager || createDefaultPromptManager()).setMultiRepoGitStates(
          gitRepos,
        );

        const repoPaths = Array.from(directoryStructures.keys());
        sessionState.multiRepoTracking = {
          repoCount: repoPaths.length,
          repoPaths,
          directoryStructureGenerated: true,
          lastCheckpointMetadata: sessionState.multiRepoTracking?.lastCheckpointMetadata,
        } as any;

        // Backwards compat flag
        sessionState.directoryStructureGenerated = true as any;
      } catch (error) {
        this._logger.warn(
          `AgentEngine: Failed to generate multi-repo structure and git state: ${(error as Error).message}`,
        );
      }
    }

    // -------------------------------------------------------------------
    // Execute the finite-state-machine driver – this is the core logic that
    // used to live inside AgentRunner.processQuery.
    // -------------------------------------------------------------------

    return this._runFsm(query, model, sessionState, executionAdapter);
  }

  /**
   * Register a new tool at runtime.
   */
  registerTool(tool: Tool) {
    this._toolRegistry.registerTool(tool);
  }

  // -----------------------------------------------------------------------
  // Execution adapter helper – one per session
  // -----------------------------------------------------------------------

  private async _ensureExecutionAdapter(sessionState: SessionState): Promise<ExecutionAdapter> {
    if (sessionState.executionAdapter) {
      return sessionState.executionAdapter;
    }

    const { adapter } = await createExecutionAdapter({
      sessionId: sessionState.id,
      eventBus: this._config.eventBus,
      type: 'local',
      logger: this._config.logger,
      projectsRoot: process.cwd(),
      autoFallback: false,
    });

    sessionState.executionAdapter = adapter;
    return adapter;
  }

  // -----------------------------------------------------------------------
  // FSM runner – inlined AgentRunner.processQuery logic
  // -----------------------------------------------------------------------

  private async _runFsm(
    query: string,
    model: string,
    sessionState: SessionState,
    executionAdapter: ExecutionAdapter,
  ) {
    const eventBus = this._config.eventBus as TypedEventEmitter<BusEvents>;

    const sessionId = sessionState.id as string;

    // Validate sessionId
    if (!sessionId) {
      this._logger.error(
        'Cannot process query: Missing sessionId in session state',
        LogCategory.SYSTEM,
      );
      return {
        error: 'Missing sessionId in session state',
        contextWindow: sessionState.contextWindow,
        done: true,
        aborted: false,
      } as any;
    }

    // Check if the session is already aborted
    if (isSessionAborted(sessionState)) {
      this._logger.info(
        `Session ${sessionId} is aborted, skipping FSM execution`,
        LogCategory.SYSTEM,
      );
      return {
        aborted: true,
        done: true,
        contextWindow: sessionState.contextWindow,
        response: 'Operation aborted by user',
      } as any;
    }

    // Keep ContextWindow and checkpoint system in sync
    attachCheckpointSync(sessionState);

    // Append user message when required
    if (
      sessionState.contextWindow.getLength() === 0 ||
      sessionState.contextWindow.getMessages()[sessionState.contextWindow.getLength() - 1].role !==
        'user'
    ) {
      sessionState.contextWindow.pushUser(query);
    }

    try {
      // Instantiate driver
      const driver = new FsmDriver({
        modelClient: this._modelClient,
        toolRegistry: this._toolRegistry,
        permissionManager: this._permissionManager,
        executionAdapter,
        logger: this._logger,
      });

      const {
        response: driverResponse,
        toolResults,
        aborted,
      } = await driver.run(query, sessionState, model);

      let response: string | undefined = driverResponse;

      // Abort handling – replicate legacy behaviour
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

        this._logger.info('Cleared abort status after handling abort in FSM', LogCategory.SYSTEM);
      }

      // Fire completion event
      eventBus.emit(BusEvent.PROCESSING_COMPLETED, {
        sessionId,
        response: response || '',
      });

      return {
        contextWindow: sessionState.contextWindow,
        response,
        done: true,
        aborted,
        result: {
          toolResults,
          iterations: driver.iterations,
        },
      } as any;
    } catch (error: unknown) {
      this._logger.error('Error in processQuery:', error as Error, LogCategory.SYSTEM);

      return {
        error: (error as Error).message,
        contextWindow: sessionState.contextWindow,
        done: true,
        aborted: isSessionAborted(sessionState),
      } as any;
    }
  }

  // -----------------------------------------------------------------------
  // Utility – standalone helper until we move it out of legacy module
  // -----------------------------------------------------------------------

  /**
   * Create a fresh SessionState for convenience – mirrors legacy helper.
   * Kept as static helper so public Agent wrapper can re-export.
   */
  static async createSessionState(
    config: CoreAgentConfig,
    sessionId?: string,
    contextWindow?: ContextWindow,
  ): Promise<SessionState> {
    const sid = sessionId ?? uuidv4();

    const { adapter } = await createExecutionAdapter({
      sessionId: sid,
      type: 'local',
      logger: config.logger,
      eventBus: config.eventBus,
      projectsRoot: process.cwd(),
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
      executionAdapter: adapter,
    } as unknown as SessionState;
  }
}
