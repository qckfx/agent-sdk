/**
 * Minimal post-build adjustments for the CommonJS (CJS) bundle of
 * `@qckfx/sdk-schema`.
 *
 * The package is authored in ESM.  In order to remain consumable from both
 * ESM and CommonJS dependants (like the current `@qckfx/agent` CJS build)
 * we generate a second compilation pass with TypeScript targeting CommonJS
 * (`tsconfig.cjs.json`).  This script finalises that build:
 *
 *   1.   Mark the output directory as explicit **CommonJS** so that `.js`
 *        files inside are evaluated with the CJS loader, even though the
 *        repository-level `package.json` declares `"type": "module"`.
 *   2.   Duplicate the main entry file as `index.cjs` so that Node can
 *        resolve the path specified in the `exports.require` condition.
 */

/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.join(__dirname, 'dist', 'cjs');

// 1. Ensure the CJS output directory is explicitly marked as CommonJS.
try {
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    JSON.stringify({ type: 'commonjs' }),
    'utf8',
  );
} catch (err) {
  console.error('postbuild-cjs: Failed to write dist/cjs/package.json', err);
  process.exitCode = 1;
}

// 2. Provide a `.cjs` file for the `exports.require` condition.
const jsEntry = path.join(outDir, 'index.js');
const cjsEntry = path.join(outDir, 'index.cjs');

try {
  if (fs.existsSync(jsEntry)) {
    fs.copyFileSync(jsEntry, cjsEntry);
  }
} catch (err) {
  console.error('postbuild-cjs: Failed to create index.cjs', err);
  process.exitCode = 1;
}
