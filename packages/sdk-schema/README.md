# Agent SDK – Schema Package

This sub-package contains **only** the versioned JSON/Zod schema for agent
configuration files. It is intentionally kept lightweight so that users who
just want to validate a `agent.json` file do **not** have to depend on the
runtime SDK.

## Versioning strategy

1.  **One folder per major schema version** (`src/v<major>.<minor>`).
    *Version 1.0* lives in `src/v1/`.

2.  Each folder exposes:
    * `agent.ts` – Zod schema (strict **+** `.strip()` to silently discard
      unknown keys like `$schema`). Exported as `AgentConfigSchemaV1`.
    * `migrate.ts` *(optional)* – functions that upgrade that version to the
      latest representation.

3.  `src/index.ts` keeps a **registry**

    ```ts
    const schemaRegistry = {
      '1.0': { schema: AgentConfigSchemaV1, upgrade: upgradeV1ToLatest },
      // add new versions here
    };
    ```

4.  The helper `parseAgentConfig()`
    * reads the `$schema` value (if any) and extracts the version,
    * picks the matching entry from the registry (falls back to latest),
    * removes the `$schema` key, validates via Zod, then applies the upgrade
      function so callers always receive the **latest** type (`AgentConfig`).

## Adding a new version (check-list)

1. Copy the previous schema folder to `src/vX.Y` and adjust fields.
2. Export it as `AgentConfigSchemaVXY` and `AgentConfigVXY`.
3. Provide an `upgradeVXYToLatest()` that converts the parsed object to the
   current latest structure.
4. Update `schemaRegistry` in `src/index.ts`:

   ```ts
   schemaRegistry['X.Y'] = { schema: AgentConfigSchemaVXY, upgrade: upgradeVXYToLatest };

   export const SCHEMA_VERSION_LATEST = 'X.Y';
   export type AgentConfig = AgentConfigVXY; // new canonical type
   ```

5. Add unit tests that parse a sample `vX.Y` file and assert correctness.

Following this checklist keeps runtime code unchanged while permitting
backwards-compatible evolution of the configuration format.
