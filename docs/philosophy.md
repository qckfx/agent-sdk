# Design Philosophy In Depth

This document explores how the core design principles of modularity and unopinionated design are implemented throughout the codebase.

## Modularity in Practice

### Provider Abstraction

The model provider system demonstrates our commitment to modularity. Each provider implements a common interface but can have completely different implementations:

```typescript
// src/types/provider.ts
export interface ModelProvider {
  generateResponse(request: ModelRequest): Promise<ModelResponse>;
}

// src/providers/AnthropicProvider.ts
export function createAnthropicProvider(options: AnthropicProviderOptions): ModelProvider {
  // Implementation details...
  return {
    generateResponse: async request => {
      // Anthropic-specific implementation
    },
  };
}
```

This makes it trivial to add support for new model providers without changing any other code.

### Tool Registry System

Tools are registered independently and can be composed into custom toolsets:

```typescript
// Example of how tools are registered
import { createTool } from '@qckfx/agent';
import { ToolRegistry } from '@qckfx/agent';

// Create a custom tool
const myCustomTool = createTool({
  name: 'myTool',
  description: 'Does something useful',
  execute: async params => {
    // Implementation
    return { result: 'success' };
  },
});

// Register tools selectively
const registry = new ToolRegistry();
registry.register(myCustomTool);
```

### Execution Environment Abstraction

The execution environment system lets you choose where tools execute without changing your agent's core logic:

```typescript
// Different execution environments through a factory pattern
// src/utils/ExecutionAdapterFactory.ts
export class ExecutionAdapterFactory {
  static create(config: ExecutionConfig): ExecutionAdapter {
    switch (config.type) {
      case 'local':
        return new LocalExecutionAdapter(config);
      case 'docker':
        return new DockerExecutionAdapter(config);
      case 'remote':
        return new E2BExecutionAdapter(config);
      default:
        throw new Error(`Unknown execution environment: ${config.type}`);
    }
  }
}
```

## Unopinionated Design in Practice

### Simple Event System

The event system is minimalistic and doesn't force specific handling patterns:

```typescript
// src/utils/sessionUtils.ts
export const AgentEvents = new EventEmitter();

export enum AgentEventType {
  ABORT_SESSION = 'abort_session',
  ENVIRONMENT_STATUS_CHANGED = 'environment_status_changed',
  PROCESSING_COMPLETED = 'processing_completed',
}

// Tool execution events are defined separately in types/tool-execution/index.ts
export enum ToolExecutionEvent {
  CREATED = 'tool_execution:created',
  UPDATED = 'tool_execution:updated',
  COMPLETED = 'tool_execution:completed',
  ERROR = 'tool_execution:error',
  ABORTED = 'tool_execution:aborted',
  PERMISSION_REQUESTED = 'tool_execution:permission_requested',
  PERMISSION_RESOLVED = 'tool_execution:permission_resolved',
  PREVIEW_GENERATED = 'tool_execution:preview_generated',
}

// Usage: Subscribe only to the events you care about
AgentEvents.on(AgentEventType.PROCESSING_COMPLETED, data => {
  console.log(`Processing completed for session: ${data.sessionId}`);
});
```

### Flexible Permission System

The permission system provides fine-grained control with three distinct tiers of permissions:

```typescript
// Using the permission manager
import { createPermissionManager } from '@qckfx/agent';

// Create a permission manager with custom UI handler
const permissionManager = createPermissionManager(toolRegistry, {
  uiHandler: {
    async requestPermission(toolId, args) {
      // Custom permission UI logic here
      console.log(`Tool ${toolId} requesting permission with args:`, args);
      return await askUserForPermission(toolId, args);
    },
  },
  initialFastEditMode: false, // Default: require permission for file operations
  DANGER_MODE: false, // Default: safer mode that requires permissions
});
```

The permission system implements a clear hierarchy of permission requirements:

#### Tier 1: No Permission Required

Tools that don't need permission will execute automatically:

```typescript
// A tool that doesn't require permission
const ReadOnlyTool = createTool({
  name: 'Info',
  description: 'Get information without modifying anything',
  requiresPermission: false, // Key setting: no permission needed
  execute: async args => {
    // Implementation that doesn't need permission
    return { result: 'Read-only information' };
  },
});
```

#### Tier 2: Standard Permission

Tools that require permission but can be auto-approved in Fast Edit Mode:

```typescript
// A file operation tool that can be auto-approved in Fast Edit Mode
const FileEditTool = createTool({
  name: 'EditFile',
  description: 'Edits a file',
  requiresPermission: true, // Requires permission by default
  category: ToolCategory.FILE_OPERATION, // Important for Fast Edit Mode
  execute: async args => {
    // Implementation
  },
});

// Toggle Fast Edit Mode to auto-approve file operations
permissionManager.setFastEditMode(true); // Now file operations won't prompt for permission
```

#### Tier 3: Always Require Permission

Tools that always require permission, regardless of Fast Edit Mode:

```typescript
// A tool that always requires permission for security reasons
const BashTool = createTool({
  name: 'Bash',
  description: 'Executes bash commands',
  requiresPermission: true,
  alwaysRequirePermission: true, // Key setting: always prompt regardless of Fast Edit Mode
  execute: async args => {
    // Implementation
  },
});
```

#### DANGER_MODE Override

For secure sandbox environments, DANGER_MODE can bypass all permission checks:

```typescript
// Only enable in secure environments like automated testing
permissionManager.enableDangerMode(); // Now ALL tools will auto-approve

// Later, restore normal security
permissionManager.disableDangerMode();
```

This tiered approach ensures appropriate security while providing flexibility for different usage scenarios.

### Prompt Management Without Restrictions

Our prompt system provides utilities but doesn't enforce a specific format:

```typescript
// Creating a custom prompt manager
import { createPromptManager } from '@qckfx/agent';

// Create a prompt manager with a fully custom system prompt
const promptManager = createPromptManager(
  `
You are an AI assistant with the following custom behavior:
- Focus on specific tasks related to ${yourDomain}
- Present information in ${yourPreferredFormat}
- Use the following tone: ${yourTone}

When solving problems, follow these steps:
${yourCustomProblemSolvingApproach}
`,
  0.3,
); // Optional temperature parameter

// Add context-specific prompt components
promptManager.setDirectoryStructurePrompt(directoryStructureContext);
promptManager.setGitStatePrompt(gitStateContext);

// Multiple system messages for optimal caching/organization
const systemPrompts = promptManager.getSystemPrompts(sessionState);
```

## Conclusion

These code examples demonstrate how the principles of modularity and unopinionated design aren't just theoretical concepts in our codebase but are directly implemented in practical ways that empower developers to build agents that work exactly how they need them to.

By focusing on clean interfaces, composable components, and minimal assumptions, we've created a framework that can grow and adapt alongside the rapidly evolving field of AI agents.
