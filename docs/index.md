# qckfx Agent SDK

Documentation for the qckfx Agent SDK for building LLM-powered agents.

## Design Philosophy

The qckfx Agent SDK is built around two core principles:

### 1. Modularity

The codebase is designed with a strong focus on modularity, allowing developers to:

- **Use only what you need**: Each component is designed to be used independently.
- **Replace any part**: Don't like our model provider? Write your own. Need custom tools? Easily integrate them.
- **Compose your ideal agent**: Build agents by composing smaller, focused components.

This modularity is evident in our:

- **Provider system**: Model providers are abstracted, making it easy to swap between different LLM backends.
- **Tool registry**: Tools are registered independently and can be composed into custom toolsets.
- **Execution environments**: Choose between local, Docker, or E2B execution without changing your agent's core logic.

### 2. Unopinionated Design

We believe that AI agent development is still evolving rapidly, so we've made deliberate choices to:

- **Avoid lock-in**: The SDK doesn't force you into specific patterns or workflows.
- **Minimize magic**: We prefer explicit configuration over hidden conventions.
- **Enable experimentation**: The architecture makes it easy to try new approaches without rebuilding everything.

Examples of our unopinionated approach include:

- **Minimal assumptions about prompt structure**: We provide utilities but don't enforce a specific prompt format.
- **Flexible permission system**: Configure exactly what your agent can and cannot do.
- **Simple event system**: Observable events without prescribing how you should handle them.

## Getting Started

### Installation

```bash
npm install @qckfx/agent
```

### Basic Usage

```typescript
import { createAgent } from '@qckfx/agent';
import { createAnthropicProvider } from '@qckfx/agent';

// Create model provider
const modelProvider = createAnthropicProvider({
  model: 'claude-3-7-sonnet-20250219'
});

// Create the agent
const agent = createAgent({
  modelProvider,
  environment: { 
    type: 'local' // or 'docker', 'e2b'
  }
});
```

## API Reference

- [API Documentation](./api/index.html)
- [Agent Interface](./api/interfaces/Agent.html)
- [createAgent Function](./api/functions/createAgent.html)

### Events

The agent SDK provides a comprehensive event system for tracking agent operations:

- [Agent Event Types](./api/enums/Events.AgentEventType.html)
- [Tool Execution Events](./api/enums/ToolExecutionEvent.html)
- [Tool Execution Status](./api/enums/ToolExecutionStatus.html)
- [Agent Events Emitter](./api/variables/Events.AgentEvents.html)

### Advanced Features

- [Tool Previews](./previews.md) - Rich visualizations of tool operations

## Features

- Modular, composition-based approach to building AI agents
- Tool-based architecture with built-in tools for file operations, bash commands, etc.
- Support for multiple execution environments (local, Docker, E2B)
- Permission management for tool executions
- Model provider abstraction (starting with Anthropic Claude)
- Rich preview system for visualizing tool operations

## Examples

Check the [examples directory](https://github.com/qckfx/agent/tree/main/examples) for sample applications.