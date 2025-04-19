/**
 * agent-core - AI Agent SDK
 * Public API exports
 */

// Re-export the original factory function
export { createAgent } from './src/index.js';

// Export events as a namespace
export * as Events from './src/events.js';

// Export main public types
export * from './src/types/main.js';