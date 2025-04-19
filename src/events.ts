/**
 * Shared event definitions and types used across agent-core and agent-platform.
 * This module provides a centralized event system for agent communication.
 * 
 * @module Events
 */

/**
 * Event emitted when a new message is added to the conversation
 * 
 * @event
 * @type {object} data
 * @property {string} sessionId - The session ID
 * @property {object} message - The message object that was added
 */
export const MESSAGE_ADDED = 'message:added';

/**
 * Event emitted when an existing message is updated
 * 
 * @event
 * @type {object} data
 * @property {string} sessionId - The session ID
 * @property {object} message - The updated message object
 * @property {string} message.id - The ID of the message that was updated
 */
export const MESSAGE_UPDATED = 'message:updated';

// Re-export AgentEventType and AgentEvents from sessionUtils for backwards compatibility
import { AgentEventType, AgentEvents } from './utils/sessionUtils.js';
export { AgentEventType, AgentEvents };