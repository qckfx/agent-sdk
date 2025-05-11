#!/usr/bin/env node
/**
 * validate-config.ts
 * -------------------
 * Stand-alone CLI utility that validates an agent configuration JSON file
 * against the official JSON schema shipped with this package.
 *
 * Usage:
 *   $ npx validate path/to/agent.json
 *
 * Exit status:
 *   0 – configuration valid
 *   1 – validation failed (or other error)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  validateConfig,
  ConfigValidationError,
} from '../utils/configValidator.js';

function printUsage(): void {
  console.log('Usage: validate <config.json>');
  console.log('Validate an agent configuration file against the built-in schema.');
}

async function main(): Promise<void> {
  const fileArg = process.argv[2];

  if (!fileArg || fileArg === '-h' || fileArg === '--help') {
    printUsage();
    process.exit(0);
  }

  try {
    const filePath = resolve(process.cwd(), fileArg);
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    validateConfig(parsed);

    console.log('Configuration is valid ✅');
    process.exit(0);
  } catch (err: unknown) {
    if (err instanceof ConfigValidationError) {
      console.error('Configuration is invalid ❌');
      console.error(err.message);
      process.exit(1);
    }

    console.error((err as Error)?.message ?? err);
    process.exit(1);
  }
}

// Execute only when run directly via node, not when imported.
// Always execute when the script is run via Node (bin wrapper will spawn it).
// Do not guard with import.meta to remain compatible with the CommonJS build.
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
