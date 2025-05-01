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

### Using with LiteLLM

This project supports using [LiteLLM](https://litellm.ai/) as a proxy for multiple model providers:

```bash
# Set the LiteLLM proxy URL 
export LLM_BASE_URL=http://localhost:8001

# Set a default model to use if model list retrieval fails
export LLM_DEFAULT_MODEL=claude-3-7-sonnet
```

The `LLM_BASE_URL` environment variable allows connecting to any LiteLLM proxy. The included configuration supports:

- Claude models (requires `ANTHROPIC_API_KEY`)
- OpenAI models (requires `OPENAI_API_KEY`)
- Gemini models (requires `GEMINI_API_KEY`)

If the available models request fails (or returns an empty list), the agent will fall back to using the model specified in the `LLM_DEFAULT_MODEL` environment variable. This ensures that the agent can continue to function even when the model list endpoint is unavailable.

#### Running the LiteLLM Proxy

To run the proxy locally using Docker:

```bash
cd litellm
docker run -p 8001:8001 litellm
```

For production deployments, you can host the LiteLLM proxy using the provided Docker configuration in the `litellm/` directory.

## Features

- Modular, composition-based approach to building AI agents
- Tool-based architecture with built-in tools for file operations, bash commands, etc.
- Support for multiple execution environments (local, Docker, E2B)
- Permission management for tool executions
- Multi-model support via LiteLLM proxy
  - Compatible with Claude, OpenAI, Gemini, and other models
  - Configure via environment variable `LLM_BASE_URL`
  - Fallback to default model with `LLM_DEFAULT_MODEL` if model list is unavailable
- Git-based checkpointing system for safe action rollbacks
  - Creates a temporary bare repository under `.agent-shadow/` without modifying user's repo
  - Allows reverting to previous states if agent makes unwanted changes

## Documentation

See the [documentation](https://qckfx.github.io/agent) for more details.

## License

MIT
