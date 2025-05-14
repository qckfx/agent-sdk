/**
 * Configuration validator for agent configuration JSON.
 *
 * This module wraps Ajv in a way that works with our ESM build target
 * (`module: "Node16"`).  Ajv is published as a **CommonJS** package, so the
 * namespace object returned by `import Ajv from 'ajv'` contains the real
 * constructor on its `.default` property.  Accessing the constructor via
 * `Ajv.default` satisfies both the TypeScript compiler and Node at runtime
 * without falling back to `require()` syntax.
 */

import AjvNs from 'ajv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Resolve schema location relative to this file (works in transpiled output)
// ---------------------------------------------------------------------------


// TypeScript (module = commonjs) doesn’t allow import.meta; suppress for that
// compile target – it is valid in the ESM build that we actually run.
// @ts-ignore TS1343 – import.meta is legal in Node16/ESM build and needed for ESM path resolution
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const __dirname = path.dirname(__filename);

const schemaPath = path.resolve(
  __dirname,
  '../../schemas/agent-config.schema.json'
);

/**
 * Ajv instance pre-configured with the JSON schema for agent configs.
 */
// Ajv is shipped as CommonJS; the constructor is on the `.default` property
// of the imported namespace object when using ESM import style.
// Cast through `any` to keep the types happy without `require()`.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const AjvConstructor: any = (AjvNs as any).default ?? (AjvNs as any);
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
const ajv = new AjvConstructor({ allErrors: true });

// Lazily load and compile the schema – avoids fs access in browser builds that
// tree-shake this module out.
let validate: ReturnType<typeof ajv.compile> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Error thrown when configuration fails schema validation.
 */
export class ConfigValidationError extends Error {
  constructor(public readonly validationErrors: unknown[], extraMsg?: string) {
    super(
      extraMsg ? `Invalid agent configuration:\n${extraMsg}` : 'Invalid agent configuration'
    );
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate a configuration object against the JSON schema.
 *
 * @template T Generic config type (preserved).
 * @param config The parsed configuration object.
 * @returns The **same** object if validation succeeds.
 * @throws {ConfigValidationError} When validation fails.
 */
export function validateConfig<T>(config: T): T {
  if (!validate) {
    // Lazily load schema only when validator is first used – avoids fs access
    // in browser bundles when validation is tree-shaken away.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    validate = ajv.compile(schema);
  }

  const isValid = validate(config);

  if (!isValid) {
    const messages = (validate.errors || [])
      .map((e: any) => `${e.instancePath} ${e.message}`)
      .join('\n');

    throw new ConfigValidationError(validate.errors ?? [], messages);
  }

  // ---------------------------------------------------------------------
  // Additional runtime guard – ensure experimental features are opted in
  // ---------------------------------------------------------------------

  // Detect whether the config declares *object*-style tool entries (which is
  // how sub-agents are expressed) and, if so, require that the corresponding
  // experimental flag is explicitly enabled.
  //
  // We perform this check *after* the schema validation succeeds so that we
  // can throw a clearer, more actionable error message than a generic Ajv
  // failure would provide.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfgAny = config as any;

  const hasSubAgentTools = Array.isArray(cfgAny.tools)
    && cfgAny.tools.some((t: any) => typeof t === 'object' && t !== null && 'configFile' in t);

  if (hasSubAgentTools && !cfgAny.experimentalFeatures?.subAgents) {
    throw new ConfigValidationError([],
      'Sub-agent tools are still experimental. Add "experimentalFeatures": { "subAgents": true } to your config to enable them.');
  }

  // ---------------------------------------------------------------------
  // Prompt files experimental guard
  // ---------------------------------------------------------------------

  const usesPromptFile = cfgAny.systemPrompt 
    && typeof cfgAny.systemPrompt === 'object' 
    && cfgAny.systemPrompt !== null 
    && 'file' in cfgAny.systemPrompt;

  if (usesPromptFile && !cfgAny.experimentalFeatures?.promptFiles) {
    throw new ConfigValidationError([],
      'Using an external prompt file is still experimental. Add "experimentalFeatures": { "promptFiles": true } to your config to enable it.');
  }

  // ---------------------------------------------------------------------
  // Local environment experimental guard
  // ---------------------------------------------------------------------

  const usesLocalEnv = cfgAny.environment && cfgAny.environment.type === 'local';

  if (usesLocalEnv && !cfgAny.experimentalFeatures?.localEnvironment) {
    throw new ConfigValidationError([],
      'Running in the host environment (type = "local") is still experimental. Add "experimentalFeatures": { "localEnvironment": true } to your config to enable it.');
  }

  return config;
}
