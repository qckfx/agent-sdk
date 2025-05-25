/**
 * Discriminated union types for tool execution results
 */

export interface ToolSuccess<Data = unknown> {
  ok: true;
  data: Data;
}

export interface ToolError {
  ok: false;
  error: string;
}

export type ToolResult<Data = unknown> = ToolSuccess<Data> | ToolError;

/**
 * Type for tracking the last tool error in session state
 */
export interface LastToolError {
  toolId: string;
  error: string;
  args: Record<string, unknown>;
}