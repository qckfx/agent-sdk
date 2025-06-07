# qckfx Agent SDK

A modular, OpenAI-compatible framework for building LLM-powered **coding agents** with tool execution capabilities.

[![npm version](https://badge.fury.io/js/%40qckfx%2Fagent.svg)](https://www.npmjs.com/package/@qckfx/agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

🔧 **Built-in Tool System** - 10 powerful tools including Claude CLI integration for cost-effective coding  
🔌 **OpenAI-Compatible** - Works with OpenAI, Anthropic, Google, and local models  
🎯 **Modular Architecture** - Compose custom toolsets and swap providers seamlessly  
📡 **Event System** - Monitor and debug agent behavior with comprehensive events  
🔄 **Session Management** - Rollback capabilities and context window management  
⚡ **CLI Integration** - Command-line tool for quick agent interactions  
🛡️ **Permission Control** - Fine-grained control over tool execution permissions

## Installation

```bash
npm install @qckfx/agent
```

## Local Development

To run and test the CLI locally during development:

```bash
# Build the project
npm run build

# Link the package globally for local testing
npm link

# Now you can run qckfx commands using your local code
qckfx "List all TypeScript files in the src directory"
qckfx "Create a simple README for this project"
```

After linking, any changes you make to the code will be reflected in the `qckfx` command after running `npm run build` again.

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
    tools: [
      'bash',
      'claude',
      'glob',
      'grep',
      'ls',
      'file_read',
      'file_edit',
      'file_write',
      'think',
      'batch',
    ],
  },
});

// Process a natural language query
const result = await agent.processQuery('What files are in this directory?');
console.log(result.response);
```

## CLI Usage

The SDK includes a command-line tool for quick interactions:

```bash
# Install globally for CLI access
npm install -g @qckfx/agent

# Use the CLI
qckfx "List all TypeScript files in the src directory"
qckfx "Create a simple README for this project"
```

## Model Provider Support

The SDK uses the OpenAI SDK internally and works with any OpenAI-compatible API endpoint:

### Direct Provider APIs

```bash
# OpenAI
export LLM_API_KEY=your_openai_key
export LLM_DEFAULT_MODEL=gpt-4

# Or use environment-specific configuration
```

### Using with LiteLLM

Set up LiteLLM to proxy requests to any provider:

```bash
# Set your LLM endpoint
export LLM_BASE_URL=http://localhost:8001  # LiteLLM server
export LLM_DEFAULT_MODEL=claude-3-5-sonnet-20241022

# Run LiteLLM proxy with Docker
cd litellm
docker build -t qckfx-litellm .
docker run -p 8001:8001 \
  -e ANTHROPIC_API_KEY=your_key \
  -e OPENAI_API_KEY=your_key \
  -e GEMINI_API_KEY=your_key \
  qckfx-litellm
```

### Using with OpenRouter

```bash
export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_API_KEY=your_openrouter_key
export LLM_DEFAULT_MODEL=anthropic/claude-3.5-sonnet
```

## Built-in Tools

The SDK includes these powerful built-in tools:

| Tool         | Description                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `bash`       | Execute shell commands with full environment access                                                     |
| `claude`     | **⭐ Claude CLI Integration** - Use the familiar Claude coding assistant for cost-effective development |
| `glob`       | Find files using powerful pattern matching                                                              |
| `grep`       | Search file contents with regex support                                                                 |
| `ls`         | List directory contents with detailed information                                                       |
| `file_read`  | Read file contents with encoding support                                                                |
| `file_edit`  | Edit files with targeted replacements                                                                   |
| `file_write` | Write new files or overwrite existing ones                                                              |
| `think`      | Internal reasoning and planning capabilities                                                            |
| `batch`      | Execute multiple tools in parallel for efficiency                                                       |

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

### Environment Variables

Configure the SDK behavior with these environment variables:

```bash
# LLM Configuration
LLM_BASE_URL=http://localhost:8001        # OpenAI-compatible API endpoint
LLM_API_KEY=your_api_key                  # API key for the endpoint
LLM_DEFAULT_MODEL=your_preferred_model    # Fallback model if discovery fails

# Model Discovery
LIST_MODELS_URL=http://localhost:8001/models  # Endpoint to list available models

# Remote Execution (planned feature)
REMOTE_ID=your_remote_session_id          # Required for remote execution
```

## Advanced Usage

### Event System

Monitor agent behavior with comprehensive event callbacks:

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

### Custom Tools

Extend the agent with your own tools:

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

### Context Window Management

Manage conversation context for multi-turn interactions:

```typescript
// Create custom context window
const contextWindow = await Agent.createContextWindow([
  { role: 'user', content: 'Previous conversation...' },
]);

// Use with query processing
const result = await agent.processQuery('Continue our discussion', undefined, contextWindow);
```

### Session Management

Control agent execution and state:

```typescript
// Session control
agent.abort(); // Abort current processing
agent.isAborted(); // Check abort status
agent.clearAbort(); // Clear abort flag
agent.performRollback(messageId); // Rollback to specific message (including environment changes)

// Permission management
agent.setFastEditMode(true); // Skip edit confirmations
agent.setDangerMode(true); // Allow dangerous operations

// Tool execution
const toolResult = await agent.invokeTool('bash', { command: 'ls -la' });
```

### Multi-Repository Support

Work with multiple repositories in a single session:

```typescript
// Get repository information from session
const repoInfo = Agent.getMultiRepoInfo(sessionState);
if (repoInfo) {
  console.log(`Tracking ${repoInfo.repoCount} repositories`);
  console.log('Paths:', repoInfo.repoPaths);
}
```

### Model Discovery

Dynamically discover available models:

```typescript
// List available models from the configured endpoint
const models = await Agent.getAvailableModels(apiKey, logger);
console.log('Available models:', models);
```

## Architecture

The SDK is built with a modular architecture that promotes flexibility and extensibility:

- **Agent Class** - Main entry point and session management
- **Tool Registry** - Manages built-in and custom tools with standardized interfaces
- **Provider System** - OpenAI-compatible LLM communication layer
- **Execution Environment** - Local tool execution (remote execution planned)
- **Event System** - Observable agent and tool lifecycle events
- **Permission Manager** - Fine-grained control over tool execution permissions

This modular design allows you to:

- Swap LLM providers without changing application code
- Compose custom toolsets for specific use cases
- Monitor and debug agent behavior comprehensively
- Extend functionality with custom tools and integrations

## Examples

### Basic File Operations

```typescript
const agent = await Agent.create({
  config: {
    tools: ['file_read', 'file_write', 'ls'],
  },
});

const result = await agent.processQuery('Read the package.json file and create a summary');
```

### Development Workflow

```typescript
const agent = await Agent.create({
  config: {
    tools: ['bash', 'file_read', 'file_edit', 'grep'],
    systemPrompt: 'You are a helpful development assistant.',
  },
});

const result = await agent.processQuery('Find all TODO comments and create a task list');
```

### Code Analysis

```typescript
const agent = await Agent.create({
  config: {
    tools: ['glob', 'grep', 'file_read', 'think'],
  },
});

const result = await agent.processQuery(
  'Analyze the codebase structure and identify potential improvements',
);
```

### Using with Claude CLI

Leverage the power of the familiar Claude coding assistant for cost-effective development:

```typescript
const agent = await Agent.create({
  config: {
    tools: ['claude', 'bash', 'file_read', 'file_edit'],
    systemPrompt: 'You are a helpful coding assistant.',
  },
});

// Use Claude CLI for complex coding tasks
const result = await agent.processQuery('Refactor this component to use TypeScript interfaces');
```

The `claude` tool integrates with the local Claude CLI, allowing you to:

- **Save money** by using your existing Claude subscription
- **Work with familiar tools** you already know and love
- **Leverage Claude's advanced coding capabilities** within the agent framework
- **Seamlessly combine** Claude's expertise with other tools

## Documentation

For comprehensive documentation, examples, and API reference, visit:
[https://docs.qckfx.com](https://docs.qckfx.com)

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [Documentation](https://docs.qckfx.com)
- 🐛 [Issue Tracker](https://github.com/qckfx/agent/issues)

---

Built with ❤️ by the qckfx team
