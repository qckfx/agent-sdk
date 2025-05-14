/**
 * Build-time helper that writes `agent-config.schema.json` next to the package
 * root. This is invoked via the "generate:schema" NPM script after TypeScript
 * compilation so that we can import the compiled JS version here (avoids the
 * need for ts-node in the build pipeline).
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

import { toJsonSchema } from './index.js';

async function main(): Promise<void> {
  const jsonSchema = await toJsonSchema();

  // Resolve path two levels up: dist/ -> package root
  const __filename = fileURLToPath(import.meta.url);
  const pkgRoot = path.resolve(path.dirname(__filename), '..');
  const outPath = path.join(pkgRoot, 'agent-config.schema.json');

  writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`📄  JSON Schema written to ${path.relative(process.cwd(), outPath)}`);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
