/**
 * sessionStore.ts – Enhanced persistence for qckfx CLI conversation history.
 *
 * Key features (2024-06):
 *   • Session files are grouped PER WORKING DIRECTORY so that `--continue`
 *     resumes the most recent conversation started from the same directory.
 *   • Each stored session records additional metadata:
 *       – absolute cwd where the run started
 *       – git commit SHA (if inside a Git repo)
 *   • File structure on disk is easy to query – upcoming sub-agents can scan
 *     JSON files without a database/index.
 *   • Robust / CLI-only / cross-platform behaviour is preserved: never throw on
 *     IO, never add heavy runtime deps.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

// We may safely import types from core – they don’t create new runtime deps.
import type { Message } from '../types/contextWindow.js';
import { ContextWindow } from '../types/contextWindow.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const POINTER_FILE = 'last.json';
const SESSIONS_ROOT_DIR = 'sessions';

/** Platform-specific base directory (~/Library/Application Support etc.) */
export function getAppDataDir(): string {
  const home = os.homedir();

  let base: string;
  switch (process.platform) {
    case 'darwin':
      base = path.join(home, 'Library', 'Application Support');
      break;
    case 'linux':
      base = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
      break;
    default: // Windows and others – rely on APPDATA or fall back to home
      base = process.env.APPDATA || path.join(home, '.qckfx');
      break;
  }

  return path.join(base, 'qckfx');
}

const ensureDir = (dir: string): void => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
};

const encodeCwd = (cwd: string): string => {
  // Use base64url (Node 20) to create safe directory names
  try {
    // @ts-expect-error Node 20 adds 'base64url' encoding; fallback handled below
    return Buffer.from(cwd).toString('base64url');
  } catch {
    return Buffer.from(cwd).toString('base64').replace(/=+$/, '');
  }
};

const getGitCommit = (cwd: string): string | undefined => {
  try {
    const out = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || undefined;
  } catch {
    return undefined; // not a git repo
  }
};

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/**
 * Extract a serialisable representation from a ContextWindow instance.
 * @param source The source to serialize
 * @returns serialisable messages or unknown
 */
// eslint-disable-next-line jsdoc/require-returns
// eslint-disable-next-line jsdoc/require-param-description
// eslint-disable-next-line jsdoc/require-param-type
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
function toSerializableMessages(source: ContextWindow | Message[] | unknown): Message[] | unknown {
  if (source instanceof ContextWindow) return source.getMessages();
  return source;
}

/**
 *
 * @param source
 * @returns Message[] | unknown
 */
/**
 * Extract a serialisable representation from a ContextWindow instance.
 * @param source
 * @returns serialisable messages or unknown
 */
function toSerializableMessages(source: ContextWindow | Message[] | unknown): Message[] | unknown {
  if (source instanceof ContextWindow) return source.getMessages();
  return source;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface StoredSession {
  createdAt: string;
  cwd: string;
  gitCommit?: string;
  messages: Message[];
  title?: string;
}

// ---------------------------------------------------------------------------
// Save / Load API
// ---------------------------------------------------------------------------

/**
 * Persist the provided ContextWindow (or raw messages) to disk.
 * @param source
 */
export function saveSession(source: ContextWindow | Message[] | undefined): void {
  if (!source) return;

  try {
    const cwd = process.cwd();
    const cwdEncoded = encodeCwd(cwd);

    const baseDir = path.join(getAppDataDir(), SESSIONS_ROOT_DIR, cwdEncoded);
    ensureDir(baseDir);

    const createdAt = new Date();
    const iso = createdAt.toISOString();
    const fileName = iso.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '') + '.json';

    const data: StoredSession = {
      createdAt: iso,
      cwd,
      gitCommit: getGitCommit(cwd),
      messages: toSerializableMessages(source) as Message[],
    };

    // Write the session file
    fs.writeFileSync(path.join(baseDir, fileName), JSON.stringify(data), 'utf8');

    // Update pointer for quick resume
    fs.writeFileSync(path.join(baseDir, POINTER_FILE), JSON.stringify({ fileName }), 'utf8');
  } catch {
    // fail silently to keep CLI robust
  }
}

/**
 * Load the most recent session for the CURRENT working directory.
 * Returns null when nothing can be loaded.
 */
export function loadLastSession(): { messages: Message[]; createdAt: string } | null {
  try {
    const cwdEncoded = encodeCwd(process.cwd());
    const baseDir = path.join(getAppDataDir(), SESSIONS_ROOT_DIR, cwdEncoded);
    const pointerPath = path.join(baseDir, POINTER_FILE);

    if (!fs.existsSync(pointerPath)) return null;

    const { fileName } = JSON.parse(fs.readFileSync(pointerPath, 'utf8')) as { fileName: string };
    if (!fileName) return null;

    const sessionPath = path.join(baseDir, fileName);
    if (!fs.existsSync(sessionPath)) return null;

    const stored = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as StoredSession;
    if (!stored.messages) return null;

    return { messages: stored.messages, createdAt: stored.createdAt };
  } catch {
    return null;
  }
}
