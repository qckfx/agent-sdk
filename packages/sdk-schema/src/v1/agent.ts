import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Schema version 1.0                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Execution environment declaration
 *
 * Both keys are optional so an empty object – or omitting the `environment`
 * block entirely – is allowed and represents the _default_ local execution
 * with no extra repositories.
 *
 * Example:
 *   {
 *     "dockerfile": "./Dockerfile",
 *     "repos": ["openai/openai-cookbook"]
 *   }
 */
const EnvironmentSchema = z
  .object({
    // Relative path (string) to a Dockerfile used for this agent. Optional.
    dockerfile: z.string().optional(),

    // Additional GitHub repositories (owner/repo) the agent should have
    // access to.  These are *in addition* to the repository the agent lives
    // in, which is always included automatically.
    repos: z
      .array(
        z
          .string()
          // Basic validation for "owner/repo" slug
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, {
            message: 'Repository must be in the form "owner/repo"',
          }),
      )
      .optional(),
  })
  .strict();

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
    environment: EnvironmentSchema.optional(),

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
