/**
 * Types and interfaces for the tool registry
 */

import { Tool, ParameterSchema, ToolContext, ToolCategory } from './tool.js';
import { ToolResult } from './tool-result.js';

export interface ToolDescription {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  requiredParameters: string[];
  requiresPermission: boolean;
  category?: ToolCategory | ToolCategory[];
  alwaysRequirePermission?: boolean;
}

export interface ToolRegistry {
  registerTool(tool: Tool): void;
  getTool(toolId: string): Tool | undefined;
  getAllTools(): Tool[];
  getToolDescriptions(): ToolDescription[];
  
  // New methods for category-based tool management
  getToolsByCategory(category: ToolCategory): Tool[];
  isToolInCategory(toolId: string, category: ToolCategory): boolean;
  
  // Methods for tool execution event handling
  onToolExecutionStart(callback: (executionId: string, toolId: string, toolUseId: string, args: Record<string, unknown>, context: ToolContext) => void): () => void;
  onToolExecutionComplete(callback: (executionId: string, toolId: string, args: Record<string, unknown>, result: unknown, executionTime: number) => void): () => void;
  onToolExecutionError(callback: (executionId: string, toolId: string, args: Record<string, unknown>, error: Error) => void): () => void;
  
  // Function to execute a tool with callback notifications
  executeToolWithCallbacks(toolId: string, toolUseId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}