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
    // Always overwrite the .cjs shim with the freshly‑built .js file.  This
    // guarantees that the CommonJS entry points stay perfectly in sync with
    // their ES module counterparts and prevents subtle bugs where stale
    // copies (from previous builds or published packages) miss newer
    // exports – for example `onEnvironmentStatusChanged`.

    if (fs.existsSync(jsPath)) {
      try {
        fs.copyFileSync(jsPath, cjsPath);
      } catch (copyErr) {
        console.warn(`postbuild-cjs: Failed to copy ${rel}.js → ${rel}.cjs`, copyErr);
      }
    }
  } catch (err) {
    console.warn(`postbuild-cjs: Unable to create .cjs copy for ${rel}:`, err);
  }
}
