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
  // Public barrel files at the package root that also need a `.cjs` sibling
  // so that the `exports.require` field resolves correctly when the package
  // is consumed from CommonJS:
  //   { "./browser":   { require: "./dist/cjs/browser.cjs"   } }
  //   { "./internals": { require: "./dist/cjs/internals.cjs" } }
  //
  // Both files are compiled by tsc as `*.js` already, we merely need to copy
  // them with the additional extension so that Node can find them.
  'browser',
  'internals',
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

// ---------------------------------------------------------------------------
// 3.  Remove `import.meta` usages from the CommonJS bundle
// ---------------------------------------------------------------------------
// A handful of source files rely on `import.meta.url` during ESM execution in
// order to calculate file locations.  When those *same* files are transpiled
// to CommonJS the meta-property is **still** present in the generated output
// (we suppress the TypeScript error with `@ts-ignore`).  Unfortunately Node‘s
// CJS runtime refuses to even *parse* the construct and throws the familiar
//   "SyntaxError: Cannot use 'import.meta' outside a module".
//
// To keep a single shared TypeScript code base we patch the compiled CJS files
// after tsc has finished.  All occurrences of `import.meta.url` are replaced
// with the built-in `__filename` which provides the exact same information in
// CommonJS modules.  For one file (configValidator) we also *remove* the
// artificial re-declaration of `__filename` that only exists in the ESM branch.

/**
 * Replace every `import.meta.url` token with `__filename`.
 *
 * @param {string} file Path to a file inside the dist/cjs tree
 */
function rewriteImportMeta(file) {
  let src = fs.readFileSync(file, 'utf8');

  if (!src.includes('import.meta')) {
    return; // nothing to do – skip early for performance
  }

  // 1) If the file contains a *re-declaration* of "__filename" based on
  //    `import.meta.url` we can simply drop that line – Node already provides
  //    the variable in CJS and re-assigning it is not only unnecessary but
  //    also error-prone once `import.meta.url` is removed.
  src = src.replace(/const __filename\s*=.*import\.meta\.url[^;]*;?\n?/g, '');
  // Lines that *still* redeclare the variable after an earlier replacement –
  // e.g. `const __filename = fileURLToPath(__filename);` – are equally useless
  // in CJS and can go, too.
  src = src.replace(/const __filename\s*=.*fileURLToPath\([^;]*;?\n?/g, '');

  // As a very last resort drop any line that starts with the redeclaration –
  // this is intentionally broad but confined to the build output directory.
  src = src.replace(/^const __filename\s*=.*\n?/m, '');

  // 3) A similar one-off exists for `__dirname`.  When the ESM variant runs it
  //    derives the directory from the freshly-created __filename above.  In
  //    CommonJS, however, Node already provides __dirname so we simply drop
  //    the re-declaration to avoid the "Identifier has already been declared"
  //    error.
  src = src.replace(/^const __dirname\s*=.*\n?/m, '');

  // 2) Replace **all** remaining occurrences of the meta-property with the
  //    built-in `__filename`.  Doing the removal first avoids the
  //    "const __filename = fileURLToPath(__filename)" artefact we saw during
  //    initial testing.
  src = src.replace(/import\.meta\.url/g, '__filename');

  fs.writeFileSync(file, src, 'utf8');
}

// Walk the dist/cjs tree and patch all .js files.
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      try {
        rewriteImportMeta(full);
      } catch (err) {
        console.warn('postbuild-cjs: Failed to rewrite', full, err);
      }
    }
  }
}

try {
  walk(outDir);
} catch (err) {
  console.error('postbuild-cjs: Error during import.meta removal', err);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 4.  Copy JSON schema files into the transpiled output directories
// ---------------------------------------------------------------------------
// The runtime configuration validator resolves the JSON Schema relative to the
// compiled file ("../../schemas/agent-config.schema.json").  Therefore the
// schema must live under both dist/cjs *and* dist/esm so that the path exists
// regardless of which module format consumers use.  We keep the canonical
// source in the repository-level "schemas" folder and replicate its contents
// here after the TypeScript build has finished.

/**
 * Recursively copy a directory (synchronously).
 *
 * @param {string} src Source directory
 * @param {string} dest Destination directory (will be created if missing)
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) {
    return; // nothing to copy – fail silently so the build does not abort
  }

  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        console.warn(`postbuild-cjs: Failed to copy schema file ${srcPath} → ${destPath}`, err);
      }
    }
  }
}

// Location of the canonical schema sources
const srcSchemasDir = path.join(__dirname, 'schemas');

// Replicate into both output formats so that the relative paths used by the
// compiled bundles resolve correctly at runtime.
const outDirs = [
  path.join(__dirname, 'dist', 'cjs', 'schemas'),
  path.join(__dirname, 'dist', 'esm', 'schemas'),
];

for (const dest of outDirs) {
  try {
    copyDirSync(srcSchemasDir, dest);
  } catch (err) {
    console.warn('postbuild-cjs: Failed to copy schemas to', dest, err);
  }
}
