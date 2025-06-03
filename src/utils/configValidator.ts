/**
 * Lightweight wrapper around the canonical schema published by
 * `@qckfx/sdk-schema` so that legacy imports (e.g. from tests or external
 * callers) continue to work even though the full JSON-schema + Ajv based
 * validator has been removed from this package.
 *
 * The public API intentionally matches the old implementation: we expose
 *   • ConfigValidationError – custom error class
 *   • validateConfig       – function that validates (and returns) the config
 *
 * Internally we delegate to the Zod schema exported by the standalone schema
 * package.  This removes the old duplicate schema definition from the agent
 * codebase while keeping the surface area unchanged.
 */

import { AgentConfigSchema } from '@qckfx/sdk-schema';
import { ZodError } from 'zod';

/**
 * Error thrown when configuration fails schema validation.
 * Mirrors the signature of the previous Ajv-based implementation so that
 * existing callers can catch the same class.
 */
export class ConfigValidationError extends Error {
  constructor(
    public readonly validationErrors: unknown[],
    extraMsg?: string,
  ) {
    super(extraMsg ? `Invalid agent configuration:\n${extraMsg}` : 'Invalid agent configuration');
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate a configuration object against the latest AgentConfig schema.
 *
 * @param config The parsed configuration object
 * @returns The **same** object if validation succeeds
 * @throws ConfigValidationError when validation fails
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function validateConfig<T = unknown>(config: T): T {
  try {
    // This will throw ZodError on failure.
    AgentConfigSchema.parse(config);
    return config;
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.errors.map((e) => `${e.path.join('.')} ${e.message}`);
      throw new ConfigValidationError(err.errors, messages.join('\n'));
    }
    // Re-throw unknown errors as ConfigValidationError for consistency
    throw new ConfigValidationError([], (err as Error)?.message ?? String(err));
  }
}
