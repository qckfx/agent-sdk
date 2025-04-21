/**
 * agent-core - AI Agent SDK for Browsers
 *
 * This file exports a minimal browser-compatible API surface.
 * It only contains types that are safe to use in browser environments.
 */

// Re-export the browser-safe types from the internals barrel
export * from './internals/index.js';

export type {
  StructuredContent,
  TextContentPart,
  ContentPart,
  ToolCallReference,
  Message,
  MessageAddedEvent,
  MessageUpdatedEvent,
} from '../src/types/message.js';
export { parseStructuredContent } from '../src/types/message.js';