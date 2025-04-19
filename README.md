# agent-core

AI Agent SDK for building LLM-powered SWE agents.

## Installation

```bash
npm install @qckfx/agent
```

## Usage

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
    type: 'docker' // or 'local', 'e2b'
  }
});

// Process a query
const sessionState = {
  contextWindow: createContextWindow(),
  abortController: new AbortController()
};
const result = await agent.processQuery('What files are in this directory?', sessionState);

console.log(result.response);
```

## Features

- Modular, composition-based approach to building AI agents
- Tool-based architecture with built-in tools for file operations, bash commands, etc.
- Support for multiple execution environments (local, Docker, E2B)
- Permission management for tool executions
- Model provider abstraction (starting with Anthropic Claude)

## Documentation

See the [documentation](https://qckfx.github.io/agent) for more details.

## License

MIT
