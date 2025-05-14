import path from 'path';
/**
 * Get a directory name that works in both ESM and CJS contexts
 * This function handles the difference between ESM and CJS module systems
 * regarding __dirname availability
 *
 * @param importMetaUrl The import.meta.url value (only needed for ESM)
 * @param dirnameFallback The __dirname value (only available in CJS)
 */
export function getDirname(importMetaUrl, dirnameFallback) {
    // In CJS environment, __dirname is provided
    if (typeof dirnameFallback !== 'undefined') {
        return dirnameFallback;
    }
    // In ESM environment, we need to calculate it from import.meta.url
    // This will be unused in CJS builds
    if (importMetaUrl) {
        try {
            // Dynamic import to avoid direct references to fileURLToPath and import.meta
            const { fileURLToPath } = require('url');
            return path.dirname(fileURLToPath(importMetaUrl));
        }
        catch (e) {
            throw new Error('Failed to determine directory name: ' + e);
        }
    }
    throw new Error('Unable to determine directory name: missing required parameters');
}
//# sourceMappingURL=dirname-helper.js.map