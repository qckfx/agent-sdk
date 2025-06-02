/**
 * Agent class - Main entry point for the agent-core SDK
 */

import { AgentCallbacks } from './types/callbacks.js';
import { SessionState } from './types/model.js';
import { Tool } from './types/tool.js';
import { createAgent } from './core/Agent.js';
import type { Agent as AgentInterface } from './types/main.js';
import { createSessionState } from './core/Agent.js';
import { ProcessQueryResult, ConversationResult } from './types/agent.js';
import { AgentConfigSchema, AgentConfig } from '@qckfx/sdk-schema';
import { CoreAgentConfig, ToolExecutionStatus } from './types/main.js';
import { convertToCoreAgentConfig } from './utils/agent-config-converter.js';
import { rollbackSession } from './utils/RollbackManager.js';
import { setSessionAborted } from './utils/sessionUtils.js';

// Import legacy event emitters
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from './events/checkpoint-events.js';
import { LLMFactory } from './providers/AnthropicProvider.js';
import { ContextWindow, createContextWindow, Message } from './types/contextWindow.js';

import { TypedEventEmitter } from './utils/TypedEventEmitter.js';
import { BusEvents, BusEventKey, BusEvent } from './types/bus-events.js';

/**
 * Main Agent class for creating and managing AI agents
 * 
 * This is the primary entry point for the agent-core SDK, replacing
 * the previous functional `createAgent` factory.
 * 
 * @example
 * ```typescript
 * import { Agent } from '@qckfx/agent';
 * 
 * const agent = new Agent({
 *   modelProvider: createAnthropicProvider(),
 *   environment: { type: 'docker' },
 *   defaultModel: 'claude-3-7-sonnet-20240219'
 * });
 * 
 * // Process a query
 * const result = await agent.processQuery('How many files are in this directory?', 'claude-3-7-sonnet-20240219');
 * console.log(result.response);
 * ```
 */
export class Agent {
  // Private members
  private _core!: AgentInterface;
  private _bus: TypedEventEmitter<BusEvents>;
  private _config!: CoreAgentConfig;
  private _callbacks?: AgentCallbacks;
  private _sessionState!: SessionState;

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  /**
   * Ensure REMOTE_ID env var is populated once per process when using the
   * remote execution environment.  Uses the user-supplied `getRemoteId`
   * callback if available.
   */
  private async _ensureRemoteId(): Promise<void> {
    if (this._config.environment.type !== 'remote') return;

    if (this._callbacks?.getRemoteId) {
      return;
    }

    // Fallback to existing environment variable (if any)
    if (process.env.REMOTE_ID?.length) {
      console.warn(
        'Remote environment specified without getRemoteId callback. ' +
        'Falling back to REMOTE_ID environment variable.'
      );
      if (!this._callbacks) {
        this._callbacks = {};
      }
      this._callbacks.getRemoteId = async () => {
        if (!process.env.REMOTE_ID) {
          throw new Error('REMOTE_ID environment variable is not set.');
        }
        return process.env.REMOTE_ID;
      };
      return;
    }

    throw new Error('Remote environment requires a getRemoteId callback or REMOTE_ID environment variable to be set.');
  }

  /**
   * Create a new Agent instance from a JSON configuration
   * 
   * @param jsonConfig The agent configuration as a JSON object
   * @param callbacks Optional runtime callbacks for events and dynamic data
   * @returns A new Agent instance
   * @throws ConfigValidationError if the config is invalid
   */
  static async create({ config, callbacks }: { config: AgentConfig; callbacks?: AgentCallbacks }): Promise<Agent> {
    // Validate the JSON config with Zod
    const validatedConfig = AgentConfigSchema.parse(config);

    // Create the agent instance (constructor will perform conversion)
    const agent = new Agent({ jsonConfig: validatedConfig, callbacks });
    await agent._init();
    return agent;
  }


  /**
   * Execute a tool manually while preserving all the bookkeeping the agent
   * normally performs when the LLM initiates the call.  This will:
   *   • append the correct `tool_use` / `tool_result` blocks to the
   *     session's ContextWindow
   *   • fire the tool execution lifecycle events that the Agent instance
   *     already re-emits (`tool:execution:*`)
   *   • honour permission prompts, abort signals and checkpoint logic – all
   *     handled internally by the same helper that the FSM driver uses.
   *
   * @param toolId        The identifier of the tool to run
   * @param args          Arguments for the tool
   * @param sessionState  Optional session.  If omitted a new one is created
   *                      (mirrors `processQuery` behaviour).
   *
   * @returns The raw value returned by the tool’s `execute` method
   */
  public async invokeTool(
    toolId: string,
    args: Record<string, unknown>,
    sessionState?: SessionState,
  ): Promise<unknown> {
    // Lazily create a session when the caller does not provide one.
    if (!sessionState) {
      sessionState = await createSessionState(this._config);
    }

    // Ensure we have an AbortController to match AgentRunner semantics.
    if (!sessionState.abortController) {
      sessionState.abortController = new AbortController();
    }

    const toolRegistry = this._core.toolRegistry;

    const tool = toolRegistry.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool '${toolId}' is not registered with this Agent.`);
    }

    // ------------------------------------------------------------------
    // Conversation history – record the tool_use message first
    // ------------------------------------------------------------------
    const { nanoid } = await import('nanoid');
    const toolUseId = nanoid();
    const cw = sessionState.contextWindow;

    // Push the tool_use.  Capture the conversation-message id so we can use
    // it as the executionId when propagating events.
    const executionId = cw.pushToolUse({
      id: toolUseId,
      name: toolId,
      input: args,
    });

    // ------------------------------------------------------------------
    // Execute through the same helper path as the FSM driver
    // ------------------------------------------------------------------
    const { withToolCall } = await import('./utils/withToolCall.js');

    // We do not need the cumulative array for external callers, but
    // withToolCall requires one for in-memory tracking.
    const toolResults: any[] = [];

    const result = await withToolCall(
      { toolId, toolUseId, args },
      sessionState,
      toolResults as any,
      (ctx) =>
        toolRegistry.executeToolWithCallbacks(toolId, toolUseId, args, ctx),
      {
        executionId,
        permissionManager: this._core.permissionManager,
        logger: this._core.logger,
        executionAdapter: sessionState.executionAdapter!,
        toolRegistry,
        sessionState,
        abortSignal: sessionState.abortController?.signal,
      },
    );

    return result;
  }
  
  /**
   * Create a new agent instance
   *
   * @param config The agent configuration object
   * @param callbacks Optional runtime callbacks for events and dynamic data
   */
  private constructor({ jsonConfig, callbacks }: { jsonConfig: AgentConfig; callbacks?: AgentCallbacks }) {
    this._bus = new TypedEventEmitter<BusEvents>();
    this._config = convertToCoreAgentConfig(jsonConfig, this._bus, callbacks);
    this._callbacks = callbacks;
    if (callbacks) {
      this._attachCallbacks(callbacks);
    }

    CheckpointEvents.on(CHECKPOINT_READY_EVENT, (payload) => {
      this._bus.emit('checkpoint:ready', payload as any);
    });
  }

  private async _init(): Promise<void> {
    this._sessionState = await createSessionState(this._config);

    // Initialize the core agent (no environment transformation needed)
    this._core = await createAgent(this._config, this._sessionState.id);

    // Bridge tool-registry events now that _core is available
    this._setupToolRegistryBridges();
  }
  

  /**
   * Hook tool-registry event emitters once the core agent has been created.
   */
  private _setupToolRegistryBridges(): void {
    if (!this._core) return;

    const resolveToolMeta = (toolId: string) => {
      const tool = this._core.toolRegistry.getTool(toolId);
      return {
        toolName: tool?.name ?? toolId,
      }
    }

    this._core.toolRegistry.onToolExecutionStart((executionId, toolId, toolUseId, args) => {
      const { toolName } = resolveToolMeta(toolId);
      this._bus.emit(BusEvent.TOOL_EXECUTION_STARTED, {
        sessionId: this._sessionState?.id,
        status: ToolExecutionStatus.PENDING,
        toolUseId: toolUseId,
        id: executionId,
        toolName,
        toolId,
        args,
      });
    });

    this._core.toolRegistry.onToolExecutionComplete((executionId, toolId, toolUseId, args, result, startTime, executionTime) => {
      const { toolName } = resolveToolMeta(toolId);

      this._bus.emit(BusEvent.TOOL_EXECUTION_COMPLETED, {
        sessionId: this._sessionState.id,
        status: ToolExecutionStatus.COMPLETED,
        id: executionId,
        toolName,
        toolId,
        args,
        result,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(startTime + executionTime).toISOString(),
        executionTime,
        toolUseId: toolUseId,
      });
    });

    this._core.toolRegistry.onToolExecutionError((executionId, toolId, toolUseId, startTime, args, error) => {
      const { toolName } = resolveToolMeta(toolId);

      this._bus.emit('tool:execution:error', {
        sessionId: this._sessionState.id,
        status: ToolExecutionStatus.ERROR,
        id: executionId,
        toolName,
        toolId,
        args,
        error,
        startTime: new Date(startTime).toISOString(),
        toolUseId: toolUseId
      });
    });
  }
  
  /**
   * Attach callbacks to the event bus
   * @param callbacks The callback functions to attach
   */
  private _attachCallbacks(callbacks: AgentCallbacks): void {
    if (callbacks.onProcessingStarted) {
      this._bus.on(BusEvent.PROCESSING_STARTED, callbacks.onProcessingStarted);
    }
    
    if (callbacks.onProcessingCompleted) {
      this._bus.on(BusEvent.PROCESSING_COMPLETED, callbacks.onProcessingCompleted);
    }
    
    if (callbacks.onProcessingError) {
      this._bus.on(BusEvent.PROCESSING_ERROR, callbacks.onProcessingError);
    }
    
    if (callbacks.onProcessingAborted) {
      this._bus.on(BusEvent.PROCESSING_ABORTED, callbacks.onProcessingAborted);
    }
    
    if (callbacks.onToolExecutionStarted) {
      this._bus.on(BusEvent.TOOL_EXECUTION_STARTED, callbacks.onToolExecutionStarted);
    }
    
    if (callbacks.onToolExecutionCompleted) {
      this._bus.on(BusEvent.TOOL_EXECUTION_COMPLETED, callbacks.onToolExecutionCompleted);
    }
    
    if (callbacks.onToolExecutionError) {
      this._bus.on(BusEvent.TOOL_EXECUTION_ERROR, callbacks.onToolExecutionError);
    }
    
    if (callbacks.onEnvironmentStatusChanged) {
      this._bus.on(BusEvent.ENVIRONMENT_STATUS_CHANGED, callbacks.onEnvironmentStatusChanged);
    }
    
    if (callbacks.onCheckpointReady) {
      this._bus.on(BusEvent.CHECKPOINT_READY, callbacks.onCheckpointReady);
    }
  }
  
  /**
   * Process a natural language query with the agent
   * 
   * @param query The query string to process
   * @param model Optional model to use (required if defaultModel not set in config)
   * @param contextWindow Optional context window. If omitted, the session will continue.
   * @returns A promise that resolves to the query result
   * @throws Error if no model is provided and no defaultModel is set in config
   */
  async processQuery(
    query: string, 
    model?: string, 
    contextWindow?: ContextWindow
  ): Promise<ProcessQueryResult> {
    await this._ensureRemoteId();

    const chosenModel = model ?? this._config.defaultModel;
    
    if (!chosenModel) {
      throw new Error(
        'Model must be supplied either in processQuery() or as defaultModel in config'
      );
    }

    if (contextWindow) {
      this._sessionState.contextWindow = contextWindow;
    }
    
    this._sessionState.abortController = new AbortController();
    this._sessionState.aborted = false;

    return this._core.processQuery(query, chosenModel, this._sessionState);
  }

  static async createContextWindow(messages?: Message[]): Promise<ContextWindow> {
    return createContextWindow(messages);
  }
  
  abort() {
    setSessionAborted(this._sessionState, this._bus);
  }

  isAborted() {
    return this._sessionState.aborted;
  }

  clearAbort() {
    this._sessionState.aborted = false;
  }

  performRollback(messageId: string) {
    return rollbackSession(this._sessionState, messageId, this._bus);
  }

  static async performRollback(sessionState: SessionState, messageId: string) {
    const bus = new TypedEventEmitter<BusEvents>();
    return rollbackSession(sessionState, messageId, bus);
  }

  static async getAvailableModels(llmApiKey?: string) {
    return LLMFactory.getAvailableModels(llmApiKey);
  }

  setFastEditMode(enabled: boolean) {
    this._core.permissionManager.setFastEditMode(enabled);
  }

  setDangerMode(enabled: boolean) {
    if (enabled) {
      this._core.permissionManager.enableDangerMode();
    } else {
      this._core.permissionManager.disableDangerMode();
    }
  }

  get environment(): 'docker' | 'local' | 'remote' | undefined {
    return this._core.environment?.type;
  }
  
  /**
   * Register a new tool with the agent
   * @param tool The tool to register
   */
  registerTool(tool: Tool): void {
    this._core.registerTool(tool);
  }
  
  /**
   * Subscribe to an agent event
   * 
   * @param event The event name to subscribe to
   * @param handler The event handler function
   * @returns A function that can be called to unsubscribe the handler
   */
  on<E extends BusEventKey>(
    event: E, 
    handler: (data: BusEvents[E]) => void
  ): () => void {
    this._bus.on(event, handler);
    return () => this._bus.off(event, handler);
  }
  
  /**
   * Unsubscribe from an agent event
   * 
   * @param event The event name to unsubscribe from
   * @param handler The event handler function to remove
   */
  off<E extends BusEventKey>(
    event: E,
    handler: (data: BusEvents[E]) => void
  ): void {
    this._bus.off(event, handler);
  }
  
  /**
   * Get multi-repo tracking information for a session
   * @param sessionState The session state to extract multi-repo data from
   * @returns Multi-repo tracking data or null if not available
   */
  static getMultiRepoInfo(sessionState: SessionState): {
    repoCount: number;
    repoPaths: string[];
    directoryStructureGenerated: boolean;
    lastCheckpointMetadata?: {
      toolExecutionId: string;
      timestamp: string;
      repoCount: number;
      hostCommits: Record<string, string>;
    };
  } | null {
    return sessionState.multiRepoTracking || null;
  }
  
  /**
   * Get the repository count for a session
   * @param sessionState The session state to check
   * @returns Number of repositories being tracked (0 if not available)
   */
  static getRepositoryCount(sessionState: SessionState): number {
    return sessionState.multiRepoTracking?.repoCount ?? 0;
  }
  
  /**
   * Get the repository paths for a session
   * @param sessionState The session state to check
   * @returns Array of repository paths being tracked
   */
  static getRepositoryPaths(sessionState: SessionState): string[] {
    return sessionState.multiRepoTracking?.repoPaths ?? [];
  }
}