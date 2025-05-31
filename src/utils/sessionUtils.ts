/**
 * Utility functions for working with session state
 * @module SessionUtils
 * @internal
 */
import { BusEvent, BusEvents } from '../types/bus-events.js';
import { SessionState } from '../types/model.js';
import { GitRepositoryInfo, DirtyRepositoryStatus } from '../types/repository.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';

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
// All event handling is now performed through a per-Agent TypedEventEmitter.

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
  environmentType: 'local' | 'docker' | 'remote';
  
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
 * Check if a session has been aborted
 * This function is used to check if an operation should be stopped mid-execution.
 * 
 * @param sessionId The session ID to check
 * @returns Whether the session has been aborted
 * @internal
 */
export function isSessionAborted(sessionState: SessionState): boolean {
  // Check for aborted events in the session registry - the single source of truth
  return sessionState.aborted;
}

/**
 * Get the timestamp when a session was aborted
 * @param sessionId The session ID to check
 * @returns The timestamp when the session was aborted, or null if not aborted
 * @internal
 */
export function getAbortTimestamp(sessionState: SessionState): number | null {
  return sessionState.abortedAt ?? null;
}

/**
 * Mark a session as aborted
 * @param sessionId The session ID to abort
 * @returns The timestamp when the session was aborted
 * @internal
 */
export function setSessionAborted(sessionState: SessionState, eventBus: TypedEventEmitter<BusEvents>): number {
  // Update the centralized abort registry with the current timestamp
  const timestamp = Date.now();
  sessionState.aborted = true;
  
  // Emit abort event for all listeners
  eventBus.emit(BusEvent.PROCESSING_ABORTED, { sessionId: sessionState.id });
  
  return timestamp;
}

/**
 * Clear aborted status for a session
 * @param sessionId The session ID to clear
 * @internal
 */
export function clearSessionAborted(sessionState: SessionState): void {
  sessionState.aborted = false;
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