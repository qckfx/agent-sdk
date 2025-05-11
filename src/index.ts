/**
 * Public entry-point for the agent SDK.
 *
 * Only the high-level `Agent` class and supporting TypeScript helper types are
 * exported.  All internal modules, global event emitters, providers, tools,
 * etc. remain private implementation details.
 */

export { Agent } from './Agent.js';

// Type helpers for consumers who want strong typing on callbacks/events.
export type {
  AgentCallbacks,
  AgentEvent,
  AgentEventMap,
} from './types/public.js';
