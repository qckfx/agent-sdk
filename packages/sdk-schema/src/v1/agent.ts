import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Schema version 1.0                                                          */
/* -------------------------------------------------------------------------- */

const EnvironmentSchema = z.union([
  z.object({ type: z.literal('local') }).strict(),
  z.object({ type: z.literal('docker') }).strict(),
  z.object({ type: z.literal('remote') }).strict(),
]);

const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

const SystemPromptSchema = z.union([
  z.string(),
  z.object({ file: z.string() }).strict(),
]);

const SubAgentToolSchema = z.object({
  name: z.string(),
  configFile: z.string(),
}).strict();

const ToolSchema = z.union([z.string(), SubAgentToolSchema]);

const ExperimentalFeaturesSchema = z
  .object({
    subAgents: z.boolean().optional().default(false),
    promptFiles: z.boolean().optional().default(false),
    localEnvironment: z.boolean().optional().default(false),
  })
  .strict()
  .default({});

export const AgentConfigSchemaV1 = z
  .object({
    environment: EnvironmentSchema,

    defaultModel: z.string().optional(),
    logLevel: LogLevelSchema.optional().default('info'),
    description: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    cachingEnabled: z.boolean().optional().default(true),
    systemPrompt: SystemPromptSchema.optional(),
    tools: z.array(ToolSchema).optional(),
    experimentalFeatures: ExperimentalFeaturesSchema.optional(),
  })
  .strict()
  .strip(); // Accept extra keys like "$schema" and discard them.

export type AgentConfigV1 = z.infer<typeof AgentConfigSchemaV1>;

// Alias without version suffix so tooling can import generically
export const AgentConfigSchema = AgentConfigSchemaV1;

// Identity upgrader because v1 is the latest.
export const upgradeV1ToLatest = (cfg: AgentConfigV1): AgentConfigV1 => cfg;
