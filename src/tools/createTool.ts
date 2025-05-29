/**
 * Base tool factory - Creates a standardized tool interface
 */

import { 
  Tool, 
  ToolConfig, 
  ToolContext, 
  ValidationResult 
} from '../types/tool.js';
import { ToolResult } from '../types/tool-result.js';

/**
 * Creates a tool with a standardized interface
 * @param config - Tool configuration
 * @returns The tool interface
 */
export const createTool = <Res extends ToolResult>(config: ToolConfig<Res>): Tool<Res> => {
  // Validate required config
  if (!config.id) throw new Error('Tool requires an id');
  if (!config.name) throw new Error('Tool requires a name');
  if (!config.description) throw new Error('Tool requires a description');
  if (!config.execute || typeof config.execute !== 'function') {
    throw new Error('Tool requires an execute function');
  }
  
  // Enhanced default validator that checks required parameters
  const defaultValidator = (args: Record<string, unknown>): ValidationResult => {
    const requiredParams = config.requiredParameters || [];
    const missingParams = requiredParams.filter(param => !Object.prototype.hasOwnProperty.call(args, param));
    
    if (missingParams.length > 0) {
      return { 
        valid: false, 
        reason: `Missing required parameters: ${missingParams.join(', ')}` 
      };
    }
    
    // Check parameter types if we have a schema
    if (config.parameters) {
      const typeErrors: string[] = [];
      
      Object.entries(args).forEach(([key, value]) => {
        const paramSchema = config.parameters?.[key];
        if (paramSchema && paramSchema.type) {
          let validType = true;
          
          switch(paramSchema.type) {
            case 'string':
              validType = typeof value === 'string';
              break;
            case 'number':
            case 'integer':
              validType = typeof value === 'number';
              break;
            case 'boolean':
              validType = typeof value === 'boolean';
              break;
            case 'array':
              validType = Array.isArray(value);
              break;
            case 'object':
              validType = typeof value === 'object' && value !== null && !Array.isArray(value);
              break;
          }
          
          if (!validType) {
            typeErrors.push(`Parameter '${key}' should be of type '${paramSchema.type}', got '${typeof value}'`);
          }
        }
      });
      
      if (typeErrors.length > 0) {
        return {
          valid: false,
          reason: typeErrors.join('; ')
        };
      }
    }
    
    return { valid: true };
  };
  
  // Use provided validator or enhanced default
  const validateArgs = (args: Record<string, unknown>): ValidationResult => {
    // First run the default validation for required params and types
    const defaultValidation = defaultValidator(args);
    if (!defaultValidation.valid) {
      return defaultValidation;
    }
    
    // If default validation passes, run custom validation if provided
    if (config.validateArgs) {
      return config.validateArgs(args);
    }
    
    return defaultValidation;
  };
  
  // The public interface
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    requiresPermission: !!config.requiresPermission,
    // Add schema information for Claude
    parameters: config.parameters || {},
    requiredParameters: config.requiredParameters || [],
    // Add category information if provided
    ...(config.category && { category: config.category }),
    // Add always require permission flag if provided
    ...(config.alwaysRequirePermission !== undefined && { 
      alwaysRequirePermission: config.alwaysRequirePermission 
    }),
    
    /**
     * Execute the tool
     * @param args - Arguments for the tool
     * @param context - Execution context
     * @returns The result of execution
     */
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<Res> {
      // Validate args first
      const validationResult = validateArgs(args);
      if (!validationResult.valid) {
        throw new Error(`Invalid args for ${this.name}: ${validationResult.reason}`);
      }
      
      // ------------------------------------------------------------------
      // Permission handling
      // ------------------------------------------------------------------

      if ((this.requiresPermission || this.alwaysRequirePermission) && context.permissionManager) {
        // Always call requestPermission which will handle all the checks internally
        // This will ask for permission every time unless in fast edit mode
        const granted = await context.permissionManager.requestPermission(context.sessionState.id, this.id, args);
        if (!granted) {
          throw new Error(`Permission denied for ${this.name}`);
        }
      }
      
      // Execute the actual tool logic
      return config.execute(args, context);
    }
  };
};