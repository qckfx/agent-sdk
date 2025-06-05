# qckfx Agent SDK

The qckfx Agent SDK provides a modular, OpenAI-compatible framework for building LLM-powered agents with tool execution capabilities.

## Installation

```bash
npm install @qckfx/agent
```

## Quick Start

```typescript
import { Agent } from '@qckfx/agent';

// Create an agent with default configuration
const agent = await Agent.create({
  config: {
    defaultModel: 'google/gemini-2.5-pro-preview',
    environment: 'local',
    logLevel: 'info',
    systemPrompt: 'You are a helpful AI assistant.',
    tools: ['bash', 'glob', 'grep', 'ls', 'file_read', 'file_edit', 'file_write', 'think', 'batch'],
  },
});

// Process a natural language query
const result = await agent.processQuery('What files are in this directory?');
console.log(result.response);
```

## OpenAI-Compatible Model Support

The SDK uses the OpenAI SDK internally and works with any OpenAI-compatible API endpoint. This includes:

- **OpenAI models** via OpenAI API
- **Anthropic Claude** via LiteLLM or OpenRouter
- **Google Gemini** via LiteLLM or OpenRouter
- **Local models** via LiteLLM, Ollama, or other OpenAI-compatible servers

### Using with LiteLLM

Set up LiteLLM to proxy requests to any provider:

```bash
# Set your LLM endpoint
export LLM_BASE_URL=http://localhost:8001  # LiteLLM server
export LLM_DEFAULT_MODEL=claude-3-5-sonnet-20241022

# Or use OpenRouter
export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_DEFAULT_MODEL=anthropic/claude-3.5-sonnet
```

### Using with OpenRouter

```bash
export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_API_KEY=your_openrouter_key
export LLM_DEFAULT_MODEL=anthropic/claude-3.5-sonnet
```

## Configuration

### Agent Configuration Schema

```typescript
interface AgentConfig {
  defaultModel?: string; // Default: 'google/gemini-2.5-pro-preview'
  environment?: 'local'; // Only 'local' is currently supported
  logLevel?: 'debug' | 'info' | 'warn' | 'error'; // Default: 'info'
  systemPrompt?: string; // Custom system prompt
  tools?: (string | ToolConfig)[]; // Built-in tools or custom tool configs
  experimentalFeatures?: {
    subAgents?: boolean; // Default: false
  };
}
```

### Built-in Tools

The SDK includes these built-in tools:

- **`bash`** - Execute shell commands
- **`glob`** - Find files by pattern matching
- **`grep`** - Search file contents
- **`ls`** - List directory contents
- **`file_read`** - Read file contents
- **`file_edit`** - Edit files with targeted replacements
- **`file_write`** - Write new files or overwrite existing ones
- **`think`** - Internal reasoning and planning
- **`batch`** - Execute multiple tools in parallel

## Core Features

### Agent Class Methods

```typescript
// Create agent from configuration
const agent = await Agent.create({ config });

// Process natural language queries
const result = await agent.processQuery(query, model?, contextWindow?);

// Execute tools manually
const toolResult = await agent.invokeTool('bash', { command: 'ls -la' });

// Register custom tools
agent.registerTool(customTool);

// Session management
agent.abort();                    // Abort current processing
agent.isAborted();               // Check abort status
agent.clearAbort();              // Clear abort flag
agent.performRollback(messageId); // Rollback to specific message

// Permission management
agent.setFastEditMode(true);     // Skip edit confirmations
agent.setDangerMode(true);       // Allow dangerous operations
```

### Event System

Subscribe to agent events for monitoring and debugging:

```typescript
const agent = await Agent.create({
  config: {
    /* ... */
  },
  callbacks: {
    onProcessingStarted: data => console.log('Processing started:', data),
    onProcessingCompleted: data => console.log('Completed:', data.response),
    onProcessingError: error => console.error('Error:', error),
    onToolExecutionStarted: data => console.log('Tool started:', data.toolName),
    onToolExecutionCompleted: data => console.log('Tool completed:', data.result),
    onToolExecutionError: data => console.error('Tool error:', data.error),
  },
});

// Or subscribe after creation
const unsubscribe = agent.on('tool:execution:completed', data => {
  console.log(`Tool ${data.toolName} completed in ${data.executionTime}ms`);
});
```

### Context Window Management

```typescript
// Create custom context window
const contextWindow = await Agent.createContextWindow([
  { role: 'user', content: 'Previous conversation...' },
]);

// Use with query processing
const result = await agent.processQuery('Continue our discussion', undefined, contextWindow);
```

## Environment Variables

Configure the SDK behavior with these environment variables:

```bash
# LLM Configuration
LLM_BASE_URL=http://localhost:8001        # OpenAI-compatible API endpoint
LLM_API_KEY=your_api_key                  # API key for the endpoint

# Remote Execution (if using remote environment)
REMOTE_ID=your_remote_session_id          # Required for remote execution

# Model Discovery
LIST_MODELS_URL=http://localhost:8001/models  # Endpoint to list available models
```

## Advanced Usage

### Custom Tools

```typescript
import { Tool } from '@qckfx/agent';

const customTool: Tool = {
  name: 'my_tool',
  description: 'Does something useful',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input parameter' },
    },
    required: ['input'],
  },
  execute: async (args, context) => {
    // Tool implementation
    return { result: `Processed: ${args.input}` };
  },
};

agent.registerTool(customTool);
```

### Multi-Repository Support

```typescript
// Get repository information from session
const repoInfo = Agent.getMultiRepoInfo(sessionState);
if (repoInfo) {
  console.log(`Tracking ${repoInfo.repoCount} repositories`);
  console.log('Paths:', repoInfo.repoPaths);
}
```

### Model Discovery

```typescript
// List available models from the configured endpoint
const models = await Agent.getAvailableModels(apiKey, logger);
console.log('Available models:', models);
```

## Architecture

The SDK is built with a modular architecture:

- **Agent Class** - Main entry point and session management
- **Tool Registry** - Manages built-in and custom tools
- **Provider System** - OpenAI-compatible LLM communication
- **Execution Environment** - Local tool execution (remote planned)
- **Event System** - Observable agent and tool lifecycle events
- **Permission Manager** - Controls tool execution permissions

## Examples

Check the project repository for complete examples and use cases.

## API Reference

For detailed API documentation, see the generated TypeScript definitions included with the package.
