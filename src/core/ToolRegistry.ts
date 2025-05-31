/**
 * ToolRegistry - Manages the collection of available tools for the agent
 * @internal
 */

import { Tool, ToolContext, ToolCategory } from '../types/tool.js';
import { ToolDescription, ToolRegistry } from '../types/registry.js';
import { ToolResult } from '../types/tool-result.js';

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
  
  const startCallbacks: Array<(executionId: string, toolId: string, startTime: number, toolUseId: string, args: Record<string, unknown>, context: ToolContext) => void> = [];
  const completeCallbacks: Array<(executionId: string, toolId: string, toolUseId: string, args: Record<string, unknown>, result: unknown, startTime: number, executionTime: number) => void> = [];
  const errorCallbacks: Array<(executionId: string, toolId: string, toolUseId: string, startTime: number, args: Record<string, unknown>, error: Error) => void> = [];
  
  return {
    /**
     * Register a tool with the registry
     * @param tool - The tool to register
     */
    registerTool(tool: Tool): void {
      console.info('Registering tool:', tool.id);
      if (!tool || !tool.id) {
        console.error('Invalid tool:', tool);
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
    onToolExecutionStart(callback: (executionId: string, toolId: string, startTime: number, toolUseId: string, args: Record<string, unknown>, context: ToolContext) => void): () => void {
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
    onToolExecutionComplete(callback: (executionId: string, toolId: string, toolUseId: string, args: Record<string, unknown>, result: unknown, startTime: number, executionTime: number) => void): () => void {
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
    onToolExecutionError(callback: (executionId: string, toolId: string, toolUseId: string, startTime: number, args: Record<string, unknown>, error: Error) => void): () => void {
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
     * @param toolUseId - The ID of the tool use message
     * @param args - The arguments to pass to the tool
     * @param context - The execution context
     * @returns The result of the tool execution
     */
    async executeToolWithCallbacks(toolId: string, toolUseId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      console.info('Executing tool with callbacks', JSON.stringify(tools), toolId);
      const tool = tools.get(toolId);
      if (!tool) {
        console.error('Tool not found', toolId);
        throw new Error(`Tool ${toolId} not found`);
      }

      // Notify start callbacks
      startCallbacks.forEach(callback => callback(context.executionId, toolId, startTime, toolUseId, args, context));
      
      const startTime = Date.now();
      try {
        console.info('Executing tool: ', JSON.stringify(tool, null, 2));
        // Execute the tool
        const result = await tool.execute(args, context);
        console.info('Tool execution complete');
        
        // Calculate execution time
        const executionTime = Date.now() - startTime;
       
        // Notify complete callbacks
        completeCallbacks.forEach(callback => 
          callback(context.executionId, toolId, toolUseId, args, result, startTime, executionTime)
        );
        
        return result;
      } catch (error) {
        console.error('Tool execution error:', error);
        // Notify error callbacks
        errorCallbacks.forEach(callback => 
          callback(context.executionId, toolId, toolUseId, startTime, args, error instanceof Error ? error : new Error(String(error)))
        );
        
        // Re-throw the error
        throw error;
      }
    }
  };
}

// Export for internals barrel
export { createToolRegistry };