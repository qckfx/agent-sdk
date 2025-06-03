# Tool Previews

The @qckfx/agent SDK includes a comprehensive previewing system that enhances user experience by providing rich, type-specific visualizations of tool operations. This document explains how the preview system works and how to use it in your applications.

## Overview

Previews provide a way to visualize tool operations before and after they execute. They can show:

- File content changes (diffs)
- Command outputs
- File listings
- JSON data
- Images
- Error information

Each preview has both a brief summary and (optionally) detailed content, allowing interfaces to show abbreviated information initially and expand when needed.

## Preview Types

The SDK supports multiple preview content types through the `PreviewContentType` enum:

| Type        | Description             | Use Cases                               |
| ----------- | ----------------------- | --------------------------------------- |
| `TEXT`      | Plain text content      | Command outputs, log files, simple text |
| `CODE`      | Syntax-highlighted code | Source code files, configuration files  |
| `DIFF`      | File differences        | File edits, changes between versions    |
| `DIRECTORY` | Directory listings      | File browser, navigation                |
| `JSON`      | Structured data         | API responses, configuration data       |
| `IMAGE`     | Image data              | Screenshots, diagrams, visual output    |
| `BINARY`    | Binary file preview     | Non-text files, executables             |
| `ERROR`     | Error information       | Tool execution failures, exceptions     |

## Preview Lifecycle

Previews are integrated with the tool execution lifecycle:

1. **Before Execution**: When a tool requires permission, a preview can be generated to show what the tool will do.
2. **After Execution**: When a tool completes, a preview shows the result of the operation.

The `ToolExecutionManager` automatically generates previews at these points in the lifecycle.

## Events

The following events are emitted during the preview lifecycle:

- `ToolExecutionEvent.PREVIEW_GENERATED`: Emitted when a new preview is created
- `ToolExecutionEvent.PERMISSION_REQUESTED`: Includes preview data to show what the tool will do
- `ToolExecutionEvent.COMPLETED`: Includes preview data showing the operation result

## Example: Working with Previews

### Listening for Preview Events

```typescript
import { createAgent, ToolExecutionEvent } from '@qckfx/agent';

const agent = createAgent({
  modelProvider,
  environment: { type: 'local' },
});

// Listen for preview events
agent.on(ToolExecutionEvent.PREVIEW_GENERATED, data => {
  const { execution, preview } = data;

  console.log(`Preview generated for ${execution.toolName}:`);
  console.log(`Content type: ${preview.contentType}`);
  console.log(`Brief summary: ${preview.briefContent}`);

  if (preview.fullContent) {
    console.log(`Full content available (${preview.fullContent.length} characters)`);
  }
});
```

### Different Preview Types

#### Text Preview

```typescript
// Example of a text preview
{
  contentType: PreviewContentType.TEXT,
  briefContent: "First 5 lines of output...",
  fullContent: "Complete output with all lines...",
  lineCount: 120,
  isTruncated: false
}
```

#### Diff Preview

```typescript
// Example of a diff preview
{
  contentType: PreviewContentType.DIFF,
  briefContent: "Modified 3 lines in file.js",
  fullContent: "Complete diff with all changes...",
  changesSummary: {
    additions: 5,
    deletions: 2
  },
  filePath: "/path/to/file.js"
}
```

#### Directory Preview

```typescript
// Example of a directory listing preview
{
  contentType: PreviewContentType.DIRECTORY,
  briefContent: "Directory with 15 files, 3 folders",
  entries: [
    { name: "file1.js", isDirectory: false, size: 1024 },
    { name: "images", isDirectory: true }
  ],
  path: "/path/to/directory",
  totalFiles: 15,
  totalDirectories: 3
}
```

## Implementation Details

The preview system is built on several key interfaces:

- `ToolPreviewState`: Represents the current state of a preview
- `PreviewManager`: Creates and manages previews
- `ToolExecutionManager`: Integrates previews with tool executions

Each tool can implement custom preview generation logic to produce the most appropriate visualization for its operations.

## Display Modes

Previews support different display modes through the `PreviewMode` enum:

- `RETRACTED`: Hidden or minimized
- `BRIEF`: Shows only the summary
- `COMPLETE`: Shows the full content

This allows UIs to control how much detail to show based on user preference or context.

## Best Practices

1. **Always check content type**: Handle each preview type appropriately based on its content type.
2. **Support progressive disclosure**: Start with brief content and allow users to expand for more detail.
3. **Handle large content efficiently**: Some previews may contain large amounts of data; implement virtualization or pagination for better performance.
4. **Provide fallbacks**: Not all tool executions will have previews; ensure your UI handles this gracefully.

## Conclusion

The preview system provides a powerful way to enhance the user experience when working with AI agent tools. By visualizing tool operations before and after execution, users can better understand, verify, and interact with agent-driven processes.
