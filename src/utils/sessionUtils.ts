/**
 * Utility functions for working with session state
 * @module SessionUtils
 * @internal
 */
import { EventEmitter } from 'events';
import { GitRepositoryInfo, DirtyRepositoryStatus } from '../types/repository.js';

/**
 * Global event emitter for agent-wide events
 * This provides a centralized event system that doesn't rely on object references
 * 
 * @example
 * ```typescript
 * import { AgentEvents, AgentEventType } from '@qckfx/agent';
 * 
 * // Listen for the processing completed event
 * AgentEvents.on(AgentEventType.PROCESSING_COMPLETED, (data) => {
 *   console.log(`Processing completed for session: ${data.sessionId}`);
 *   console.log(`Response: ${data.response}`);
 * });
 * ```
 */
export const AgentEvents = new EventEmitter();

/**
 * Event types for agent operations
 * 
 * These events represent high-level agent lifecycle and operational events
 * that can be subscribed to through the {@link AgentEvents} emitter.
 * 
 * @enum {string}
 */
export enum AgentEventType {
  /**
   * Emitted when a session is manually aborted by the user or system
   * @event
   * @type {string} sessionId - The ID of the aborted session
   */
  ABORT_SESSION = 'abort_session',
  
  /**
   * Emitted when the execution environment status changes
   * @event
   * @type {EnvironmentStatusEvent} - Environment status information
   */
  ENVIRONMENT_STATUS_CHANGED = 'environment_status_changed',
  
  /**
   * Emitted when the agent completes processing a user query
   * @event
   * @type {object} data
   * @property {string} sessionId - The session ID
   * @property {string} response - The response text from the agent
   */
  PROCESSING_COMPLETED = 'processing_completed'
}

/**
 * Environment status update event data
 * 
 * This interface represents the data structure emitted with the
 * {@link AgentEventType.ENVIRONMENT_STATUS_CHANGED} event.
 * 
 * @interface
 * @internal
 */
export interface EnvironmentStatusEvent {
  /**
   * The type of execution environment
   */
  environmentType: 'local' | 'docker' | 'e2b';
  
  /**
   * Current status of the environment
   */
  status: 'initializing' | 'connecting' | 'connected' | 'disconnected' | 'error';
  
  /**
   * Whether the environment is ready to execute tools
   */
  isReady: boolean;
  
  /**
   * Error message if status is 'error'
   */
  error?: string;
}

/**
 * Track aborted sessions with timestamps
 * This is the single source of truth for abort status
 * @internal
 */
export const abortedSessions = new Map<string, number>();

/**
 * Check if a session has been aborted
 * This function is used to check if an operation should be stopped mid-execution.
 * 
 * @param sessionId The session ID to check
 * @returns Whether the session has been aborted
 * @internal
 */
export function isSessionAborted(sessionId: string): boolean {
  // Check for aborted events in the session registry - the single source of truth
  return abortedSessions.has(sessionId);
}

/**
 * Get the timestamp when a session was aborted
 * @param sessionId The session ID to check
 * @returns The timestamp when the session was aborted, or null if not aborted
 * @internal
 */
export function getAbortTimestamp(sessionId: string): number | null {
  return abortedSessions.get(sessionId) ?? null;
}

/**
 * Mark a session as aborted
 * @param sessionId The session ID to abort
 * @returns The timestamp when the session was aborted
 * @internal
 */
export function setSessionAborted(sessionId: string): number {
  // Update the centralized abort registry with the current timestamp
  const timestamp = Date.now();
  abortedSessions.set(sessionId, timestamp);
  
  // Emit abort event for all listeners
  AgentEvents.emit(AgentEventType.ABORT_SESSION, sessionId);
  
  return timestamp;
}

/**
 * Clear aborted status for a session
 * @param sessionId The session ID to clear
 * @internal
 */
export function clearSessionAborted(sessionId: string): void {
  abortedSessions.delete(sessionId);
}

/**
 * IMPORTANT: MESSAGE HISTORY RULES WHEN ABORTING OPERATIONS
 * 
 * When aborting an operation, we must ensure that the conversation history maintains proper structure.
 * The LLM APIs require specific formatting in the conversation history:
 * 
 * 1. Every `tool_use` message must be followed by a matching `tool_result` message with the same tool_use_id
 * 2. If a tool call is aborted, we still need to add a proper `tool_result` message
 *    with an "aborted: true" status to maintain the conversation flow
 * 
 * Failure to properly pair tool_use with tool_result will result in errors like:
 * "messages.X: `tool_use` ids were found without `tool_result` blocks immediately after"
 * 
 * When aborting operations, the AgentRunner handles this by:
 * - Adding appropriate tool_result messages to the conversation history
 * - Including an aborted:true flag in the result
 * - Maintaining the tool_use_id pairing between tool calls and results
 * 
 * This ensures we don't "brick" the agent even when operations are aborted mid-execution.
 */

/**
 * Format git repository information as a context prompt
 * @param gitInfo Git repository information
 * @returns Formatted string for use in system prompt
 * @internal
 */
export function formatGitInfoAsContextPrompt(gitInfo: GitRepositoryInfo | null): string | null {
  if (!gitInfo || !gitInfo.isGitRepository) {
    return null;
  }
  
  // Format the status information
  let statusInfo = '';
  if (gitInfo.status.type === 'clean') {
    statusInfo = '(clean)';
  } else {
    const dirtyStatus = gitInfo.status as DirtyRepositoryStatus;
    const parts = [];
    
    // Only include sections that have files
    if (dirtyStatus.modifiedFiles.length > 0) {
      parts.push(`Modified:\n  ${dirtyStatus.modifiedFiles.join('\n  ')}`);
    }
    
    if (dirtyStatus.stagedFiles.length > 0) {
      parts.push(`Staged:\n  ${dirtyStatus.stagedFiles.join('\n  ')}`);
    }
    
    if (dirtyStatus.untrackedFiles.length > 0) {
      parts.push(`Untracked:\n  ${dirtyStatus.untrackedFiles.join('\n  ')}`);
    }
    
    if (dirtyStatus.deletedFiles.length > 0) {
      parts.push(`Deleted:\n  ${dirtyStatus.deletedFiles.join('\n  ')}`);
    }
    
    statusInfo = parts.join('\n\n');
  }
  
  // Format the prompt as a context block
  const prompt = `<context name="gitStatus">This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
Current branch: ${gitInfo.currentBranch}

${gitInfo.defaultBranch ? `Default branch (you will usually use this for PRs): ${gitInfo.defaultBranch}` : ''}

Status:
${statusInfo}

${gitInfo.recentCommits.length > 0 ? `Recent commits:\n${gitInfo.recentCommits.join('\n')}` : ''}
</context>`;
  
  return prompt;
}