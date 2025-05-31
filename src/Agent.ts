/**
 * Agent class - Main entry point for the agent-core SDK
 */

import { EventEmitter } from 'events';
import { AgentCallbacks } from './types/callbacks.js';
import { AgentEvent, AgentEventMap } from './types/events.js';
import { SessionState } from './types/model.js';
import { Tool } from './types/tool.js';
import { createAgent } from './core/Agent.js';
import type { Agent as AgentInterface } from './types/main.js';
import { createSessionState } from './core/Agent.js';
import { ProcessQueryResult, ConversationResult } from './types/agent.js';
import { AgentConfigSchema, AgentConfig } from '@qckfx/sdk-schema';
import { CoreAgentConfig } from './types/main.js';
import { convertToCoreAgentConfig } from './utils/agent-config-converter.js';
import { rollbackSession } from './utils/RollbackManager.js';
import { isSessionAborted, setSessionAborted, clearSessionAborted } from './utils/sessionUtils.js';

// Import legacy event emitters
import { 
  AgentEvents, 
  AgentEventType
} from './utils/sessionUtils.js';
import { 
  CheckpointEvents, 
  CHECKPOINT_READY_EVENT 
} from './events/checkpoint-events.js';
import { LLMFactory } from './providers/AnthropicProvider.js';
import { ContextWindow } from './types/contextWindow.js';
import { ToolRegistry } from './types/registry.js';

// Legacy to new event name mapping 
const LEGACY_TO_NEW_EVENT_MAP: Record<string, AgentEvent> = {
  [AgentEventType.PROCESSING_COMPLETED]: 'processing:completed',
  [AgentEventType.ABORT_SESSION]: 'processing:aborted',
  [AgentEventType.ENVIRONMENT_STATUS_CHANGED]: 'environment:status_changed',
  [CHECKPOINT_READY_EVENT]: 'checkpoint:ready',
  [AgentEventType.ROLLBACK_COMPLETED]: 'rollback:completed',
  // Tool execution events are already properly named with the 'tool:' prefix
};

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
  private _bus: EventEmitter;
  private _config: CoreAgentConfig;
  private _callbacks?: AgentCallbacks;

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
  static async create({config, callbacks}: {config: AgentConfig, callbacks?: AgentCallbacks}): Promise<Agent> {
    // Validate the JSON config with Zod
    const validatedConfig = AgentConfigSchema.parse(config);
    
    // Convert to AgentConfig
    const coreAgentConfig = convertToCoreAgentConfig(validatedConfig, callbacks);
    
    // Create the agent instance
    const agent = new Agent({config: coreAgentConfig, callbacks});
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
  private constructor({config, callbacks}: {config: CoreAgentConfig, callbacks?: AgentCallbacks}) {
    // Validate config
    this._config = config;
    this._callbacks = callbacks;

    // Create private event bus
    this._bus = new EventEmitter();

    // Set up event forwarding from legacy global emitters to instance event bus
    this._bridgeLegacyEvents();

    // Attach callbacks if provided
    if (callbacks) {
      this._attachCallbacks(callbacks);
    }
  }

  private async _init(): Promise<void> {
    // Initialize the core agent (no environment transformation needed)
    this._core = await createAgent(this._config);

    // Bridge tool-registry events now that _core is available
    this._setupToolRegistryBridges();
  }
  
  /**
   * Bridge legacy global events to instance event bus
   * This is an internal method to forward global events to this instance
   */
  private _bridgeLegacyEvents(): void {
    // Forward agent events
    for (const [legacyEvent, newEvent] of Object.entries(LEGACY_TO_NEW_EVENT_MAP)) {
      const forwarder = (data: any) => {
        console.log('Agent: Forwarding event', legacyEvent, 'to', newEvent, data);
        this._bus.emit(newEvent, data);
      };
      
      if (legacyEvent === CHECKPOINT_READY_EVENT) {
        CheckpointEvents.on(legacyEvent, forwarder);
      } else {
        AgentEvents.on(legacyEvent, forwarder);
      }
    }
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

    this._core.toolRegistry.onToolExecutionStart((executionId, toolId, _toolUseId, args) => {
      const { toolName } = resolveToolMeta(toolId);
      this._bus.emit('tool:execution:started', {
        id: executionId,
        toolName,
        toolId,
        args,
        startTime: new Date().toISOString(),
      });
    });

    this._core.toolRegistry.onToolExecutionComplete((executionId, toolId, args, result, executionTime) => {
      const { toolName } = resolveToolMeta(toolId);

      this._bus.emit('tool:execution:completed', {
        id: executionId,
        toolName,
        toolId,
        args,
        result,
        executionTime,
        endTime: new Date().toISOString(),
      });
    });

    this._core.toolRegistry.onToolExecutionError((executionId, toolId, args, error) => {
      const { toolName } = resolveToolMeta(toolId);

      this._bus.emit('tool:execution:error', {
        id: executionId,
        toolName,
        toolId,
        args,
        error,
        endTime: new Date().toISOString(),
      });
    });
  }
  
  /**
   * Attach callbacks to the event bus
   * @param callbacks The callback functions to attach
   */
  private _attachCallbacks(callbacks: AgentCallbacks): void {
    if (callbacks.onProcessingStarted) {
      this._bus.on('processing:started', callbacks.onProcessingStarted);
    }
    
    if (callbacks.onProcessingCompleted) {
      this._bus.on('processing:completed', callbacks.onProcessingCompleted);
    }
    
    if (callbacks.onProcessingError) {
      this._bus.on('processing:error', callbacks.onProcessingError);
    }
    
    if (callbacks.onProcessingAborted) {
      this._bus.on('processing:aborted', callbacks.onProcessingAborted);
    }
    
    if (callbacks.onToolExecutionStarted) {
      this._bus.on('tool:execution:started', callbacks.onToolExecutionStarted);
    }
    
    if (callbacks.onToolExecutionCompleted) {
      this._bus.on('tool:execution:completed', callbacks.onToolExecutionCompleted);
    }
    
    if (callbacks.onToolExecutionError) {
      this._bus.on('tool:execution:error', callbacks.onToolExecutionError);
    }
    
    if (callbacks.onEnvironmentStatusChanged) {
      this._bus.on('environment:status_changed', callbacks.onEnvironmentStatusChanged);
    }
    
    if (callbacks.onCheckpointReady) {
      this._bus.on('checkpoint:ready', callbacks.onCheckpointReady);
    }
  }
  
  /**
   * Process a natural language query with the agent
   * 
   * @param query The query string to process
   * @param model Optional model to use (required if defaultModel not set in config)
   * @param sessionState Optional session state
   * @returns A promise that resolves to the query result
   * @throws Error if no model is provided and no defaultModel is set in config
   */
  async processQuery(
    query: string, 
    model?: string, 
    sessionState?: SessionState
  ): Promise<ProcessQueryResult> {
    await this._ensureRemoteId();

    const chosenModel = model ?? this._config.defaultModel;
    
    if (!chosenModel) {
      throw new Error(
        'Model must be supplied either in processQuery() or as defaultModel in config'
      );
    }
    
    return this._core.processQuery(query, chosenModel, sessionState);
  }

  static async createSessionState(config: AgentConfig, getRemoteId?: (sessionId: string) => Promise<string>, sessionId?: string, contextWindow?: ContextWindow): Promise<SessionState> {
    return await createSessionState(convertToCoreAgentConfig(config, { getRemoteId }), sessionId, contextWindow);
  }
  
  /**
   * Run a simplified automated conversation
   * This method is primarily used for testing and evaluation
   * 
   * @param initialQuery The initial user query
   * @param model Optional model to use (required if defaultModel not set in config)
   * @returns A promise that resolves to the conversation result
   * @throws Error if no model is provided and no defaultModel is set in config
   */
  async runConversation(
    initialQuery: string, 
    model?: string
  ): Promise<ConversationResult> {
    await this._ensureRemoteId();

    const chosenModel = model ?? this._config.defaultModel;
    
    if (!chosenModel) {
      throw new Error(
        'Model must be supplied either in runConversation() or as defaultModel in config'
      );
    }
    
    return this._core.runConversation(initialQuery, chosenModel);
  }

  static async performRollback(sessionId: string, sessionState: SessionState, messageId: string) {
    return rollbackSession(sessionId, sessionState, messageId);
  }

  static async getAvailableModels(llmApiKey?: string) {
    return LLMFactory.getAvailableModels(llmApiKey);
  }

  static isSessionAborted(sessionId: string) {
    return isSessionAborted(sessionId);
  }

  static setSessionAborted(sessionId: string) {
    return setSessionAborted(sessionId);
  }

  static clearSessionAborted(sessionId: string) {
    return clearSessionAborted(sessionId);
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
  on<E extends AgentEvent>(
    event: E, 
    handler: (data: AgentEventMap[E]) => void
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
  off<E extends AgentEvent>(
    event: E, 
    handler: (data: AgentEventMap[E]) => void
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