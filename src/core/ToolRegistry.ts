/**
 * ToolRegistry - Manages the collection of available tools for the agent
 * @internal
 */

import { Tool, ToolContext, ToolCategory } from '../types/tool.js';
import { ToolDescription, ToolRegistry } from '../types/registry.js';
import { v5 as uuidv5 } from 'uuid';

/**
 * UUID Namespace for tool execution IDs
 * Used to generate consistent UUIDs from Anthropic tool use IDs
 * @internal
 */
const TOOL_EXECUTION_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

/**
 * Generate a stable execution ID from an Anthropic tool use ID
 * @param toolUseId The Anthropic-generated tool use ID
 * @returns A stable UUID v5 generated from the tool use ID
 * @internal
 */
function generateExecutionId(toolUseId: string): string {
  return uuidv5(toolUseId, TOOL_EXECUTION_NAMESPACE);
}

/**
 * Creates a tool registry to manage available tools
 * @returns The tool registry interface
 * @internal
 */
function createToolRegistry(): ToolRegistry {
  // Private storage for registered tools
  const tools = new Map<string, Tool>();
  // Index to look up tools by category
  const toolsByCategory = new Map<ToolCategory, Set<string>>();
  
  const startCallbacks: Array<(executionId: string, toolId: string, toolUseId: string, args: Record<string, unknown>, context: ToolContext) => void> = [];
  const completeCallbacks: Array<(executionId: string, toolId: string, args: Record<string, unknown>, result: unknown, executionTime: number) => void> = [];
  const errorCallbacks: Array<(executionId: string, toolId: string, args: Record<string, unknown>, error: Error) => void> = [];
  
  return {
    /**
     * Register a tool with the registry
     * @param tool - The tool to register
     */
    registerTool(tool: Tool): void {
      if (!tool || !tool.id) {
        throw new Error('Invalid tool: Tool must have an id');
      }
      
      tools.set(tool.id, tool);
      
      // If the tool has category information, add it to the category index
      if (tool.category) {
        // Handle both single category and arrays of categories
        const categories = Array.isArray(tool.category) ? tool.category : [tool.category];
        
        for (const category of categories) {
          if (!toolsByCategory.has(category)) {
            toolsByCategory.set(category, new Set());
          }
          
          toolsByCategory.get(category)?.add(tool.id);
        }
      }
    },
    
    /**
     * Get a tool by its ID
     * @param toolId - The ID of the tool to retrieve
     * @returns The requested tool or undefined if not found
     */
    getTool(toolId: string): Tool | undefined {
      return tools.get(toolId);
    },
    
    /**
     * Get all registered tools
     * @returns Array of all registered tools
     */
    getAllTools(): Tool[] {
      return Array.from(tools.values());
    },
    
    /**
     * Get descriptions of all tools for the model
     * @returns Array of tool descriptions
     */
    getToolDescriptions(): ToolDescription[] {
      return Array.from(tools.values()).map(tool => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        requiredParameters: tool.requiredParameters,
        requiresPermission: tool.requiresPermission,
        category: tool.category,
        alwaysRequirePermission: tool.alwaysRequirePermission
      }));
    },
    
    /**
     * Register a callback to be called when a tool execution starts
     * @param callback - The callback function to register
     * @returns A function to unregister the callback
     */
    onToolExecutionStart(callback: (executionId: string, toolId: string, toolUseId: string, args: Record<string, unknown>, context: ToolContext) => void): () => void {
      startCallbacks.push(callback);
      
      // Return unsubscribe function
      return () => {
        const index = startCallbacks.indexOf(callback);
        if (index !== -1) {
          startCallbacks.splice(index, 1);
        }
      };
    },
    
    /**
     * Register a callback to be called when a tool execution completes successfully
     * @param callback - The callback function to register
     * @returns A function to unregister the callback
     */
    onToolExecutionComplete(callback: (executionId: string, toolId: string, args: Record<string, unknown>, result: unknown, executionTime: number) => void): () => void {
      completeCallbacks.push(callback);
      
      // Return unsubscribe function
      return () => {
        const index = completeCallbacks.indexOf(callback);
        if (index !== -1) {
          completeCallbacks.splice(index, 1);
        }
      };
    },
    
    /**
     * Register a callback to be called when a tool execution encounters an error
     * @param callback - The callback function to register
     * @returns A function to unregister the callback
     */
    onToolExecutionError(callback: (executionId: string, toolId: string, args: Record<string, unknown>, error: Error) => void): () => void {
      errorCallbacks.push(callback);
      
      // Return unsubscribe function
      return () => {
        const index = errorCallbacks.indexOf(callback);
        if (index !== -1) {
          errorCallbacks.splice(index, 1);
        }
      };
    },
    
    /**
     * Get all tools in a specific category
     * @param category - The category to query
     * @returns Array of tools in the specified category
     */
    getToolsByCategory(category: ToolCategory): Tool[] {
      const toolIds = toolsByCategory.get(category) || new Set();
      return Array.from(toolIds)
        .map(id => tools.get(id))
        .filter(Boolean) as Tool[];
    },
    
    /**
     * Check if a tool belongs to a specific category
     * @param toolId - The ID of the tool to check
     * @param category - The category to check against
     * @returns Whether the tool belongs to the specified category
     */
    isToolInCategory(toolId: string, category: ToolCategory): boolean {
      const tool = tools.get(toolId);
      if (!tool || !tool.category) return false;
      
      // Check if the tool belongs to the specified category
      const categories = Array.isArray(tool.category) ? tool.category : [tool.category];
      return categories.includes(category);
    },
    
    /**
     * Execute a tool with callback notifications
     * @param toolId - The ID of the tool to execute
     * @param args - The arguments to pass to the tool
     * @param context - The execution context
     * @returns The result of the tool execution
     */
    async executeToolWithCallbacks(toolId: string, toolUseId: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
      const tool = tools.get(toolId);
      if (!tool) {
        throw new Error(`Tool ${toolId} not found`);
      }

      const executionId = generateExecutionId(toolUseId);

      // Notify start callbacks
      startCallbacks.forEach(callback => callback(executionId, toolId, toolUseId, args, context));
      
      const startTime = Date.now();
      try {
        // Execute the tool
        const result = await tool.execute(args, context);
        
        // Calculate execution time
        const executionTime = Date.now() - startTime;
       
        console.log("🟠🟠🟠executeToolWithCallbacks", toolId, args, result, executionTime);
        // Notify complete callbacks
        completeCallbacks.forEach(callback => 
          callback(executionId, toolId, args, result, executionTime)
        );
        
        return result;
      } catch (error) {
        // Notify error callbacks
        errorCallbacks.forEach(callback => 
          callback(executionId, toolId, args, error instanceof Error ? error : new Error(String(error)))
        );
        
        // Re-throw the error
        throw error;
      }
    }
  };
}

// Export for internals barrel
export { createToolRegistry };