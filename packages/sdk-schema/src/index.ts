/*
 * Stand-alone Agent configuration schema (Zod) and helpers.
 * --------------------------------------------------------------------------
 * This package intentionally contains **only** the JSON/Zod schema and very
 * lightweight utilities so that users who merely want to *author / validate*
 * configuration files do **not** have to depend on the heavy-weight runtime
 * SDK.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema – kept in sync with the canonical JSON schema.
// ---------------------------------------------------------------------------

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

const ExperimentalFeaturesSchema = z.object({
  subAgents: z.boolean().optional().default(false),
  promptFiles: z.boolean().optional().default(false),
  localEnvironment: z.boolean().optional().default(false),
}).strict().default({});

export const AgentConfigSchema = z.object({
  environment: EnvironmentSchema,

  defaultModel: z.string().optional(),
  logLevel: LogLevelSchema.optional().default('info'),
  description: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  cachingEnabled: z.boolean().optional().default(true),
  systemPrompt: SystemPromptSchema.optional(),
  tools: z.array(ToolSchema).optional(),
  experimentalFeatures: ExperimentalFeaturesSchema.optional(),
}).strict();

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Validate (and coerce defaults) for a candidate configuration object.
 *
 * The returned object is the parsed version (it may contain defaulted fields
 * in case they were omitted).
 */
export function validateConfig(input: unknown): AgentConfig {
  return AgentConfigSchema.parse(input);
}

/**
 * Return the schema as JSON Schema draft-07 document.
 * (Generated lazily to avoid heavyweight conversion when consumers only need
 * the Zod representation.)
 */
export async function toJsonSchema(): Promise<object> {
  // Dynamic import keeps the zod-to-json-schema dependency out of the main
  // bundle for users that don’t need the JSON variant.
  const { zodToJsonSchema } = await import('zod-to-json-schema');
  return zodToJsonSchema(AgentConfigSchema, 'AgentConfig');
}
