/* eslint-disable jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import path from 'path';
import { existsSync } from 'fs';

/**
 * Resolve an agent config shorthand or path to an absolute file path.
 * Shared between -a/--agent and --with-subagent options so the behaviour is
 * consistent.
 *
 * Resolution order:
 *   1. If input is an existing file (absolute or relative) → use it.
 *   2. Append .json if omitted and re-check (still relative to CWD).
 *   3. Look for .qckfx/<name>.json inside the current working directory.
 *   4. Fallback to direct path so that the caller can surface a friendly error.
 * @param input
 * @param cwd
 */
/**
 * Resolve an agent config shorthand or path to an absolute file path.
 * Shared between -a/--agent and --with-subagent options for consistent behavior.
 *
 * Resolution order:
 * 1. If input is an existing file → use it.
 * 2. Append .json if missing and re-check.
 * 3. Look for .qckfx/<name>.json in CWD.
 * 4. Fallback to direct path.
 * @param input - Shorthand or path of agent config.
 * @param cwd - Working directory (defaults to process.cwd()).
 * @returns The resolved absolute path.
 */
export function resolveAgentConfigPath(input: string, cwd = process.cwd()): string {
  // 1. As-is path
  const directPath = path.resolve(cwd, input);
  if (existsSync(directPath)) return directPath;

  // 2. Auto-append .json if missing
  const withExt = input.endsWith('.json') ? input : `${input}.json`;

  // 3. Conventional .qckfx directory
  const qckfxPath = path.resolve(cwd, '.qckfx', withExt);
  if (existsSync(qckfxPath)) return qckfxPath;

  // 4. Not found – let caller handle error.
  return directPath;
}
