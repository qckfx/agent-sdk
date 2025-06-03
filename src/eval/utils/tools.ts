/**
 * Utility functions for working with tools in evaluations
 */

import { Tool } from '../../types/tool.js';
import { ToolRegistry } from '../../types/registry.js';
import { createToolRegistry } from '../../core/ToolRegistry.js';
import { createBashTool } from '../../tools/BashTool.js';
import { createFileEditTool } from '../../tools/FileEditTool.js';
import { createFileReadTool } from '../../tools/FileReadTool.js';
import { createFileWriteTool } from '../../tools/FileWriteTool.js';
import { createGlobTool } from '../../tools/GlobTool.js';
import { createGrepTool } from '../../tools/GrepTool.js';
import { createLSTool } from '../../tools/LSTool.js';
import { createThinkTool } from '../../tools/ThinkTool.js';
import { createLogger, LogLevel } from '../../utils/logger.js';

// Create a logger for tool operations
const logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'Tools',
});

/**
 * Creates instances of all available tools
 * @returns Array of all available tool instances
 */
export function createAllTools(): Tool[] {
  return [
    createBashTool(),
    createFileEditTool(),
    createFileReadTool(),
    createFileWriteTool(),
    createGlobTool(),
    createGrepTool(),
    createLSTool(),
    createThinkTool(),
  ];
}

/**
 * Map of tool IDs to their friendly names for reporting
 */
export const TOOL_NAMES: Record<string, string> = {
  bash: 'Bash',
  file_edit: 'File Edit',
  file_read: 'File Read',
  file_write: 'File Write',
  glob: 'Glob',
  grep: 'Grep',
  ls: 'LS',
  think: 'Think',
};

/**
 * Get the friendly name of a tool by its ID
 * @param toolId Tool ID
 * @returns Friendly name or the original ID if not found
 */
export function getToolFriendlyName(toolId: string): string {
  return TOOL_NAMES[toolId] || toolId;
}

/**
 * Creates a tool registry with filtered tools based on available tool IDs
 *
 * @param availableTools Optional array of tool IDs to include (undefined for all, empty array for none)
 * @param configName Optional name to use in logging
 * @returns A tool registry with the specified tools registered
 */
export function createFilteredToolRegistry(
  availableTools?: string[],
  configName: string = 'Configuration',
): ToolRegistry {
  const toolRegistry = createToolRegistry();
  const allTools = createAllTools();

  if (availableTools === undefined) {
    // Register all tools when not specified
    allTools.forEach(tool => toolRegistry.registerTool(tool));
    logger.info(`Using all ${allTools.length} tools for ${configName}`);
  } else if (availableTools.length > 0) {
    // Register only specified tools
    const filteredTools = allTools.filter(tool => availableTools.includes(tool.id));
    filteredTools.forEach(tool => toolRegistry.registerTool(tool));
    logger.info(
      `Using ${filteredTools.length} tools for ${configName} (filtered from ${allTools.length} total tools)`,
    );
  } else {
    // Empty array means no tools
    logger.info(`Using no tools for ${configName}`);
  }

  return toolRegistry;
}
