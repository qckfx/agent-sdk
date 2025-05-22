/*
 * Agent configuration schema – versioned wrapper.
 * --------------------------------------------------------------
 * This file exposes:
 *   1. Latest Zod schema (AgentConfigSchema)
 *   2. Helper parseAgentConfig(rawJson)
 *   3. Registry so future versions can be plugged in easily.
 */


import {
  AgentConfigSchemaV1,
  AgentConfigV1,
  upgradeV1ToLatest,
} from './v1/agent.js';

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

export const SCHEMA_VERSION_LATEST = '1.0' as const;

// When new versions are added extend these maps.
const schemaRegistry = {
  '1.0': {
    schema: AgentConfigSchemaV1,
    upgrade: upgradeV1ToLatest,
  },
} as const;

type SupportedVersion = keyof typeof schemaRegistry;

// Latest type alias – after upgrading we always return this.
export type AgentConfig = AgentConfigV1;

export const AgentConfigSchema = AgentConfigSchemaV1; // re-export for backward compatibility

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function extractVersion(versionOrUrl: unknown): SupportedVersion | null {
  if (typeof versionOrUrl !== 'string') return null;

  // Accept plain version like "1.0" or URL ending in something like "/1.0.json".
  const match = versionOrUrl.match(/([0-9]+\.[0-9]+)$/);
  if (match) return match[1] as SupportedVersion;
  return null;
}

/**
 * Parse + validate a raw JSON string (or object) containing an Agent config.
 * Handles `$schema` version dispatch and upgrades older versions to the
 * canonical latest representation.
 */
export function parseAgentConfig(input: string | Record<string, unknown>): AgentConfig {
  const obj: Record<string, unknown> =
    typeof input === 'string' ? (JSON.parse(input) as Record<string, unknown>) : input;

  const version = extractVersion(obj.$schema);

  // Remove $schema so downstream .strict() schemas do not choke.
  delete obj.$schema;

  const record = version && schemaRegistry[version] ? schemaRegistry[version] : schemaRegistry[SCHEMA_VERSION_LATEST];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any = record.schema.parse(obj);
  return record.upgrade(parsed);
}

/* -------------------------------------------------------------------------- */
/* JSON-schema export helper (kept from previous API)                          */
/* -------------------------------------------------------------------------- */

/**
 * Return the *latest* schema as JSON-schema draft-07 document.
 */
export async function toJsonSchema(): Promise<object> {
  const { zodToJsonSchema } = await import('zod-to-json-schema');
  return zodToJsonSchema(AgentConfigSchema, 'AgentConfig');
}

/* -------------------------------------------------------------------------- */
/* Legacy helper                                                               */
/* -------------------------------------------------------------------------- */

/**
 * validateConfig used to be exported – keep it but delegate to new helper
 * (for backward compatibility inside the repo).
 */
export function validateConfig(input: unknown): AgentConfig {
  return AgentConfigSchema.parse(input);
}
