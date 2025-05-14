/**
 * Zod schema for agent configuration
 * 
 * This provides runtime validation and TypeScript type inference for agent configs
 */

import { z } from 'zod';

// Environment types
const localEnvironmentSchema = z.object({
  type: z.literal('local'),
});

const dockerEnvironmentSchema = z.object({
  type: z.literal('docker'),
});

const remoteEnvironmentSchema = z.object({
  type: z.literal('remote'),
});

const repositoryEnvironmentSchema = z.discriminatedUnion('type', [
  localEnvironmentSchema,
  dockerEnvironmentSchema,
  remoteEnvironmentSchema,
]);

// System prompt variants
const systemPromptFileSchema = z.object({
  file: z.string().describe('Relative or absolute path to a text file containing the system prompt'),
});

const systemPromptSchema = z.union([
  z.string(),
  systemPromptFileSchema,
]);

// Tool variants
const stringToolSchema = z.string();

const objectToolSchema = z.object({
  name: z.string(),
  configFile: z.string().describe('Path to the JSON configuration file containing the sub-agent definition'),
});

const toolSchema = z.union([stringToolSchema, objectToolSchema]);

// Experimental features
const experimentalFeaturesSchema = z.object({
  subAgents: z.boolean().default(false).describe('Enable experimental support for sub-agents exposed as tools.'),
  promptFiles: z.boolean().default(false).describe('Enable experimental support for loading the systemPrompt from an external file.'),
  localEnvironment: z.boolean().default(false).describe('Enable experimental support for executing the agent directly in the host environment.'),
}).partial().default({});

// Main agent config schema
export const agentConfigSchema = z.object({
  // Required fields
  environment: repositoryEnvironmentSchema,
  
  // Optional fields
  defaultModel: z.string().optional().describe('Default model to use when not supplied in processQuery call'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info').describe('Log level for the agent'),
  permissionMode: z.enum(['interactive', 'auto', 'manual']).default('interactive').describe('Tool permission handling mode'),
  description: z.string().optional().describe('A description of the agent. Used for sub-agents and documentation.'),
  allowedTools: z.array(z.string()).optional().describe('List of tool IDs that are allowed to be used'),
  cachingEnabled: z.boolean().default(true).describe('Whether tool execution caching is enabled'),
  systemPrompt: systemPromptSchema.optional().describe('Custom system prompt provided either inline as a string or via an external file path'),
  tools: z.array(toolSchema).optional().describe('Ordered list of tools that the agent can use'),
  experimentalFeatures: experimentalFeaturesSchema,
}).strict();

// Extract the type from the Zod schema
export type AgentConfigJSON = z.infer<typeof agentConfigSchema>;

/**
 * Error thrown when configuration fails schema validation.
 */
export class ConfigValidationError extends Error {
  constructor(public readonly validationErrors: z.ZodError | unknown[], extraMsg?: string) {
    super(
      extraMsg ? `Invalid agent configuration:\n${extraMsg}` : 'Invalid agent configuration'
    );
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate a configuration object against the Zod schema.
 * Additionally checks experimental feature flags for specific features.
 *
 * @param config The parsed configuration object.
 * @returns The validated configuration object.
 * @throws {ConfigValidationError} When validation fails.
 */
export function validateAgentConfig(config: unknown): AgentConfigJSON {
  try {
    // First validate with Zod schema
    const validatedConfig = agentConfigSchema.parse(config);
    
    // Additional runtime checks for experimental features
    const hasSubAgentTools = Array.isArray(validatedConfig.tools) &&
      validatedConfig.tools.some(t => typeof t === 'object' && 'configFile' in t);

    if (hasSubAgentTools && !validatedConfig.experimentalFeatures?.subAgents) {
      throw new ConfigValidationError([],
        'Sub-agent tools are still experimental. Add "experimentalFeatures": { "subAgents": true } to your config to enable them.');
    }

    // Prompt files experimental guard
    const usesPromptFile = validatedConfig.systemPrompt &&
      typeof validatedConfig.systemPrompt === 'object' &&
      'file' in validatedConfig.systemPrompt;

    if (usesPromptFile && !validatedConfig.experimentalFeatures?.promptFiles) {
      throw new ConfigValidationError([],
        'Using an external prompt file is still experimental. Add "experimentalFeatures": { "promptFiles": true } to your config to enable it.');
    }

    // Local environment experimental guard
    const usesLocalEnv = validatedConfig.environment && validatedConfig.environment.type === 'local';

    if (usesLocalEnv && !validatedConfig.experimentalFeatures?.localEnvironment) {
      throw new ConfigValidationError([],
        'Running in the host environment (type = "local") is still experimental. Add "experimentalFeatures": { "localEnvironment": true } to your config to enable it.');
    }

    return validatedConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors
        .map(e => `${e.path.join('.')} ${e.message}`)
        .join('\n');
      
      throw new ConfigValidationError(error, messages);
    }
    
    // Re-throw if it's already our ConfigValidationError
    if (error instanceof ConfigValidationError) {
      throw error;
    }
    
    // For any other error type
    throw new ConfigValidationError(
      [], 
      error instanceof Error ? error.message : String(error)
    );
  }
}