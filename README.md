# agent-core

AI Agent SDK for building LLM-powered SWE agents.

## Installation

```bash
npm install @qckfx/agent
```

## Usage

```typescript
import { Agent } from '@qckfx/agent';        // only runtime symbol you need
// (Provider factories etc. are internal; create or pass your own model provider)

// Create model provider
const modelProvider = createAnthropicProvider();

// Long-lived JSON config (can also load from a file)
const config = {
  modelProvider,
  environment: {
    type: 'docker' // or 'local', 'remote'
  },
  defaultModel: 'claude-3-7-sonnet-20250219', // Optional default model
  permissionMode: 'interactive', // Optional, defaults to 'interactive'
  allowedTools: ['Bash', 'FileRead'], // Optional, restrict tools
  cachingEnabled: true // Optional, defaults to true
};

// Optional runtime callbacks (e.g. event hooks, remote ID resolver)
const callbacks = {
  getRemoteId: async () => process.env.REMOTE_ID!,
  onProcessingCompleted: (data) => console.log('done:', data.response)
};

// Create the agent instance
const agent = new Agent(config, callbacks);

// Process a query with explicit model
const result = await agent.processQuery('What files are in this directory?', 'claude-3-7-sonnet-20250219');

// Or use the default model specified in config
const result2 = await agent.processQuery('Show me the README');

console.log(result.response);
```

## Validating configuration

Validate your JSON before launching an agent:

```bash
$ npx @qckfx/agent validate ./agent-config.json
```

## Configuration reference

The Agent constructor accepts a configuration object with the following properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `modelProvider` | ModelProvider | Yes | The model provider to use for generating responses |
| `environment` | RepositoryEnvironment | Yes | The execution environment configuration |
| `defaultModel` | string | No | Default model to use when not specified in processQuery calls |
| `logLevel` | 'debug' \| 'info' \| 'warn' \| 'error' | No | Log level (defaults to 'info') |
| `permissionMode` | 'interactive' \| 'auto' \| 'manual' | No | Tool permission handling mode (defaults to 'interactive') |
| `allowedTools` | string[] | No | List of tool IDs that are allowed to be used |
| `cachingEnabled` | boolean | No | Whether tool execution caching is enabled (defaults to true) |

### Environment Types

The `environment` property specifies where tools will be executed:

```typescript
// Local environment (executes in same process)
environment: { type: 'local' }

// Docker environment (executes in Docker container)
environment: { type: 'docker' }

// Remote environment (executes in remote sandbox)
environment: { type: 'remote' }
```

When using a remote environment, you'll need to provide a `getRemoteId` callback:

```typescript
const agent = new Agent(
  {
    environment: { type: 'remote' },
    // other config...
  },
  {
    // Runtime callbacks
    getRemoteId: async () => process.env.REMOTE_ID!
  }
);
```

# Using with LiteLLM

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
- Support for multiple execution environments (local, Docker, remote)
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
