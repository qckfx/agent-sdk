# Design Philosophy In Depth

This document explores how the core design principles of modularity and unopinionated design are implemented throughout the qckfx Agent SDK codebase.

## Modularity in Practice

### OpenAI-Compatible Provider System

The model provider system demonstrates our commitment to modularity through a unified OpenAI-compatible interface that works with any provider:

```typescript
// The LLMFactory creates providers that all use the OpenAI SDK internally
import { LLMFactory } from '@qckfx/agent';

// Works with any OpenAI-compatible endpoint
const provider = LLMFactory.createProvider({
  model: 'claude-3-5-sonnet-20241022', // Via LiteLLM or OpenRouter
  cachingEnabled: true,
});

// Or with direct OpenAI
const provider = LLMFactory.createProvider({
  model: 'gpt-4', // Direct OpenAI API
  cachingEnabled: true,
});
```

This design makes it trivial to switch between any OpenAI-compatible provider (OpenAI, Anthropic via LiteLLM, Google via OpenRouter, local models via Ollama, etc.) without changing any other code.

### Tool Registry System

Tools are registered independently and can be composed into custom toolsets using a standardized interface:

```typescript
// Create a custom tool using the factory
import { createTool, ToolCategory } from '@qckfx/agent';

const myCustomTool = createTool({
  id: 'my_custom_tool',
  name: 'My Custom Tool',
  description: 'Does something useful for my specific use case',
  requiresPermission: true,
  category: ToolCategory.NETWORK,
  parameters: {
    input: {
      type: 'string',
      description: 'Input parameter',
    },
    options: {
      type: 'object',
      description: 'Optional configuration',
    },
  },
  requiredParameters: ['input'],
  execute: async (args, context) => {
    // Access execution environment
    const { executionAdapter, logger, sessionState } = context;

    // Implement your tool logic
    const result = await processInput(args.input, args.options);

    return {
      ok: true,
      data: result,
      metadata: { timestamp: new Date().toISOString() },
    };
  },
});

// Register with agent
agent.registerTool(myCustomTool);
```

### Local Execution Environment

The current implementation focuses on local execution with a clean abstraction that could be extended:

```typescript
// The ExecutionAdapter interface provides a consistent API
interface ExecutionAdapter {
  executeCommand(
    executionId: string,
    command: string,
    workingDir?: string,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;

  readFile(executionId: string, filepath: string, options?: any): Promise<FileReadResult>;
  writeFile(executionId: string, filepath: string, content: string): Promise<void>;
  editFile(
    executionId: string,
    filepath: string,
    searchCode: string,
    replaceCode: string,
  ): Promise<FileEditResult>;
  // ... other file and directory operations
}
```

## Unopinionated Design in Practice

### Simple Event System

The event system is minimalistic and doesn't force specific handling patterns:

```typescript
// Events are defined as simple enums
export enum BusEvent {
  PROCESSING_STARTED = 'processing:started',
  PROCESSING_COMPLETED = 'processing:completed',
  PROCESSING_ERROR = 'processing:error',
  TOOL_EXECUTION_STARTED = 'tool:execution:started',
  TOOL_EXECUTION_COMPLETED = 'tool:execution:completed',
  TOOL_EXECUTION_ERROR = 'tool:execution:error',
  ENVIRONMENT_STATUS_CHANGED = 'environment:status_changed',
  CHECKPOINT_READY = 'checkpoint:ready',
}

// Subscribe only to the events you care about
agent.on('tool:execution:completed', data => {
  console.log(`Tool ${data.toolName} completed in ${data.executionTime}ms`);
  // Handle completion however makes sense for your application
});

// Or use callbacks during agent creation
const agent = await Agent.create({
  config: {
    /* ... */
  },
  callbacks: {
    onProcessingCompleted: data => {
      // Custom completion handling
      updateUI(data.response);
    },
    onToolExecutionError: data => {
      // Custom error handling
      logError(data.error, data.toolName);
    },
  },
});
```

### Flexible Permission System

The permission system provides fine-grained control with a clear hierarchy of permission requirements:

```typescript
// The permission manager handles three tiers of permissions
import { ToolCategory } from '@qckfx/agent';

// Tier 1: No Permission Required (readonly operations)
const readOnlyTool = createTool({
  id: 'info_tool',
  name: 'Information Tool',
  description: 'Get information without modifying anything',
  requiresPermission: false, // No permission needed
  category: ToolCategory.READONLY,
  execute: async (args, context) => {
    // Safe read-only operations
    return { ok: true, data: 'Read-only information' };
  },
});

// Tier 2: Standard Permission (can be auto-approved in Fast Edit Mode)
const fileEditTool = createTool({
  id: 'edit_file',
  name: 'Edit File',
  description: 'Edits a file with targeted replacements',
  requiresPermission: true, // Requires permission by default
  category: ToolCategory.FILE_OPERATION, // Important for Fast Edit Mode
  execute: async (args, context) => {
    return context.executionAdapter.editFile(
      context.executionId,
      args.filepath,
      args.searchCode,
      args.replaceCode,
    );
  },
});

// Tier 3: Always Require Permission (security-critical operations)
const bashTool = createTool({
  id: 'bash',
  name: 'Bash',
  description: 'Executes shell commands',
  requiresPermission: true,
  alwaysRequirePermission: true, // Always prompt regardless of Fast Edit Mode
  category: ToolCategory.SHELL_EXECUTION,
  execute: async (args, context) => {
    return context.executionAdapter.executeCommand(
      context.executionId,
      args.command,
      args.workingDir,
    );
  },
});
```

### Permission Mode Controls

```typescript
// Fast Edit Mode: Auto-approve file operations but still prompt for shell commands
agent.setFastEditMode(true);

// Danger Mode: Auto-approve ALL tools (use only in secure sandbox environments)
agent.setDangerMode(true);

// Normal Mode: Prompt for all tools that require permission
agent.setFastEditMode(false);
agent.setDangerMode(false);
```

### Tool Categories for Organized Permissions

```typescript
// Built-in categories help organize permission logic
export enum ToolCategory {
  FILE_OPERATION = 'file_operation', // File read/write/edit operations
  SHELL_EXECUTION = 'shell_execution', // Command execution
  READONLY = 'readonly', // Safe read-only operations
  NETWORK = 'network', // Network requests
}

// Tools can belong to multiple categories
const hybridTool = createTool({
  id: 'download_and_save',
  name: 'Download and Save',
  description: 'Downloads a file and saves it locally',
  category: [ToolCategory.NETWORK, ToolCategory.FILE_OPERATION],
  // ... rest of configuration
});
```

### Configuration Without Lock-in

The agent configuration is designed to be explicit and flexible:

```typescript
// Minimal configuration with sensible defaults
const agent = await Agent.create({
  config: {
    defaultModel: 'google/gemini-2.5-pro-preview',
    environment: 'local',
    logLevel: 'info',
  },
});

// Or fully customized configuration
const agent = await Agent.create({
  config: {
    defaultModel: 'claude-3-5-sonnet-20241022',
    environment: 'local',
    logLevel: 'debug',
    systemPrompt: `You are a specialized AI assistant for ${myDomain}.
    
    Follow these specific guidelines:
    - ${guideline1}
    - ${guideline2}
    
    Use these tools strategically: ${myPreferredTools.join(', ')}`,
    tools: [
      'bash',
      'file_read',
      'file_write',
      'file_edit',
      { name: 'my_custom_tool', configFile: './tools/my-tool.json' },
    ],
    experimentalFeatures: {
      subAgents: true,
    },
  },
  callbacks: {
    // Custom event handling for your specific needs
    onProcessingStarted: data => myCustomStartHandler(data),
    onToolExecutionCompleted: data => myCustomCompletionHandler(data),
  },
});
```

## Built-in Tools Demonstrate Modularity

The SDK includes a comprehensive set of built-in tools that demonstrate the modular design:

- **`bash`** - Shell command execution (always requires permission)
- **`file_read`** - File reading operations (readonly category)
- **`file_write`** - File creation and overwriting (file operation category)
- **`file_edit`** - Targeted file editing (file operation category)
- **`glob`** - Pattern-based file finding (readonly category)
- **`grep`** - Content searching (readonly category)
- **`ls`** - Directory listing (readonly category)
- **`think`** - Internal reasoning and planning (no permission required)
- **`batch`** - Parallel tool execution (inherits permissions from constituent tools)

Each tool is implemented using the same `createTool` factory and follows the same patterns, making it easy to understand how to create your own tools.

## Conclusion

These code examples demonstrate how the principles of modularity and unopinionated design are directly implemented in practical ways throughout the qckfx Agent SDK. The architecture provides:

- **Clean interfaces** that make components easily replaceable
- **Composable tools** that can be mixed and matched for specific use cases
- **Flexible permissions** that adapt to different security requirements
- **Observable events** without prescribing how you handle them
- **OpenAI compatibility** that works with any provider or model
- **Minimal assumptions** about how you want to build your agent

By focusing on these principles, we've created a framework that can grow and adapt alongside the rapidly evolving field of AI agents, while giving developers the freedom to build exactly what they need.
