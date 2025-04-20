/**
 * Post‑build adjustments for the CommonJS (CJS) bundle.
 *
 * See comments in code for details.
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'dist', 'cjs');

// 1. Ensure the CJS output directory is explicitly marked as CommonJS.
const pkgJsonPath = path.join(outDir, 'package.json');
try {
  fs.writeFileSync(pkgJsonPath, JSON.stringify({ type: 'commonjs' }), 'utf8');
} catch (err) {
  console.error('postbuild-cjs: Failed to write dist/cjs/package.json', err);
  process.exitCode = 1;
}

// 2. Create '.cjs' copies for the public entry points that are offered to CJS
//    consumers via the `exports` map.
const entryPoints = [
  'index',
  'src/tools/index',
  'src/providers/index',
  'src/internals/index',
];

for (const rel of entryPoints) {
  const jsPath = path.join(outDir, `${rel}.js`);
  const cjsPath = path.join(outDir, `${rel}.cjs`);

  try {
    if (fs.existsSync(jsPath) && !fs.existsSync(cjsPath)) {
      fs.copyFileSync(jsPath, cjsPath);
    }
  } catch (err) {
    console.warn(`postbuild-cjs: Unable to create .cjs copy for ${rel}:`, err);
  }
}
