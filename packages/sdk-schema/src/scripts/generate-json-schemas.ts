/**
 * Build-time helper that writes both a root-level *latest* JSON Schema and
 * version-specific ones next to their Zod source files. This runs after the
 * package was compiled to JS (so we import the compiled modules from `dist/`).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Resolve useful paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const pkgRoot = path.resolve(path.dirname(__filename), '../../'); // dist/scripts/.. -> package root

const distDir = path.join(pkgRoot, 'dist');

// Utility: turn "v1" -> "1.0" (major only for now)
const versionFolderToVersion = (folder: string): string => {
  const m = folder.match(/^v([0-9]+)/);
  if (!m) throw new Error(`Unsupported version folder name: ${folder}`);
  return `${m[1]}.0`;
};

async function generate(): Promise<void> {
  // 1. Find version directories (they start with 'v') in dist/
  const allEntries = await fs.readdir(distDir, { withFileTypes: true });
  const versionDirs = allEntries.filter((e) => e.isDirectory() && /^v[0-9]+/.test(e.name));

  for (const dirEnt of versionDirs) {
    const versionFolder = dirEnt.name; // e.g., v1
    const compiledModulePath = path.join(distDir, versionFolder, 'agent.js');

    // Dynamically import compiled JS
    // eslint-disable-next-line no-await-in-loop
    const mod = await import(compiledModulePath);
    const schema: unknown = mod.AgentConfigSchemaV1 ?? mod.AgentConfigSchema;
    if (!schema) {
      // eslint-disable-next-line no-console
      console.warn(`⚠️  No AgentConfigSchema export in ${compiledModulePath}`);
      continue;
    }

    // Convert to JSON Schema
    const jsonSchema = zodToJsonSchema(schema as z.ZodTypeAny, {
      name: 'AgentConfig',
      // @ts-expect-error upstream types miss the $schema option
      $schema: 'http://json-schema.org/draft-07/schema#',
    });

    // Write to src/<version>/agent.schema.json so that the file is committed.
    const srcVersionDir = path.join(pkgRoot, 'src', versionFolder);
    await fs.mkdir(srcVersionDir, { recursive: true });
    const outputPath = path.join(srcVersionDir, 'agent.schema.json');
    await fs.writeFile(outputPath, JSON.stringify(jsonSchema, null, 2));

    // Also write/update root-level latest (overwrite each iteration; last one wins)
    const rootPath = path.join(pkgRoot, 'agent-config.schema.json');
    await fs.writeFile(rootPath, JSON.stringify(jsonSchema, null, 2));

    // eslint-disable-next-line no-console
    console.log(`📄  Generated JSON Schema for ${versionFolder} -> ${path.relative(pkgRoot, outputPath)}`);
  }
}

generate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
