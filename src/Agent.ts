/**
 * Agent class - Main entry point for the agent-core SDK
 */

import { EventEmitter } from 'events';
import { AgentConfig } from './types/main.js';
import { AgentCallbacks } from './types/callbacks.js';
import { AgentEvent, AgentEventMap } from './types/events.js';
import { SessionState } from './types/model.js';
import { Tool } from './types/tool.js';
import { createAgent } from './core/Agent.js';
import { Agent as AgentInterface } from './types/main.js';
import { ProcessQueryResult, ConversationResult } from './types/agent.js';
import { validateConfig } from './utils/configValidator.js';

// Import legacy event emitters
import { 
  AgentEvents, 
  AgentEventType, 
  EnvironmentStatusEvent 
} from './utils/sessionUtils.js';
import { 
  CheckpointEvents, 
  CHECKPOINT_READY_EVENT 
} from './events/checkpoint-events.js';

// Legacy to new event name mapping 
const LEGACY_TO_NEW_EVENT_MAP: Record<string, AgentEvent> = {
  [AgentEventType.PROCESSING_COMPLETED]: 'processing:completed',
  [AgentEventType.ABORT_SESSION]: 'processing:aborted',
  [AgentEventType.ENVIRONMENT_STATUS_CHANGED]: 'environment:status_changed',
  [CHECKPOINT_READY_EVENT]: 'checkpoint:ready',
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
  private _core: AgentInterface;
  private _bus: EventEmitter;
  private _config: AgentConfig;
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
      // Always fetch if callback provided to ensure freshest ID
      process.env.REMOTE_ID = await this._callbacks.getRemoteId();
      return;
    }

    // Fallback to existing environment variable (if any)
    if (process.env.REMOTE_ID?.length) return;
  }
  
  /**
   * Create a new agent instance
   *
   * @param config The agent configuration object
   * @param callbacks Optional runtime callbacks for events and dynamic data
   */
  constructor(config: AgentConfig, callbacks?: AgentCallbacks) {
    // Validate config
    this._config = validateConfig(config);
    this._callbacks = callbacks;

    // Validate remote environment configuration
    if (config.environment.type === 'remote' && !callbacks?.getRemoteId) {
      console.warn(
        'Remote environment specified without getRemoteId callback. ' +
        'Falling back to REMOTE_ID environment variable.'
      );
    }

    // Create private event bus
    this._bus = new EventEmitter();

    // Initialize the core agent (no environment transformation needed)
    this._core = createAgent(config);

    // Set up event forwarding from legacy global emitters to instance event bus
    this._bridgeLegacyEvents();

    // Attach callbacks if provided
    if (callbacks) {
      this._attachCallbacks(callbacks);
    }
  }

  /**
   * Prepare configuration with dynamic data from callbacks
   * This method handles dynamic data like remote IDs before passing to core
   * @private
   */
  private _prepareConfig(config: AgentConfig): AgentConfig {
    // For remote environments, we don't need to transform the config
    // The actual adapter resolution happens in the core/Agent.ts file
    return config;
  }
  
  /**
   * Bridge legacy global events to instance event bus
   * This is an internal method to forward global events to this instance
   */
  private _bridgeLegacyEvents(): void {
    // Forward agent events
    for (const [legacyEvent, newEvent] of Object.entries(LEGACY_TO_NEW_EVENT_MAP)) {
      const forwarder = (data: any) => {
        this._bus.emit(newEvent, data);
      };
      
      if (legacyEvent === CHECKPOINT_READY_EVENT) {
        CheckpointEvents.on(legacyEvent, forwarder);
      } else {
        AgentEvents.on(legacyEvent, forwarder);
      }
    }
    
    // Bridge tool execution callbacks from ToolRegistry
    this._core.toolRegistry.onToolExecutionStart((executionId, toolId, _toolUseId, args) => {
      this._bus.emit('tool:execution:started', {
        executionId,
        toolId,
        args
      });
    });

    this._core.toolRegistry.onToolExecutionComplete((executionId, toolId, args, result, executionTime) => {
      this._bus.emit('tool:execution:completed', {
        executionId,
        toolId,
        args,
        result,
        executionTime
      });
    });

    this._core.toolRegistry.onToolExecutionError((executionId, toolId, args, error) => {
      this._bus.emit('tool:execution:error', {
        executionId,
        toolId,
        args,
        error
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
   */
  on<E extends AgentEvent>(
    event: E, 
    handler: (data: AgentEventMap[E]) => void
  ): void {
    this._bus.on(event, handler);
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
}