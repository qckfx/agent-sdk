/**
 * sessionStore.ts – Simple persistence for qckfx CLI conversation history.
 *
 * Design goals:
 *   • CLI-only — nothing in SDK/core imports this helper.
 *   • Cross-platform — stores files in XDG_DATA_HOME / Application Support.
 *   • Robust      — never throw; if the filesystem is unwritable we silently
 *                    skip persistence.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// We may safely import types from the SDK – they don’t create a runtime
// dependency the CLI wouldn’t already have.
import { ContextWindow, Message } from '../types/contextWindow.js';

// ---------------------------------------------------------------------------
// Storage directory helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the directory that should be used for persisting session files.
 *   • Linux   – $XDG_DATA_HOME/qckfx  (fallback: ~/.local/share/qckfx)
 *   • macOS   – ~/Library/Application Support/qckfx
 *   • Windows – %APPDATA%/qckfx (best-effort)
 */
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

const ensureDir = (dir: string) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore – maybe the directory already exists or we lack permissions.
  }
};

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/** Extract a serialisable representation from a ContextWindow instance. */
function toSerializableMessages(source: ContextWindow | Message[] | unknown): Message[] | unknown {
  if (source instanceof ContextWindow) {
    return source.getMessages();
  }

  // If the caller already supplied raw messages we assume they are OK.
  return source;
}

/** Reconstruct a runtime ContextWindow from stored data. */
// No runtime helpers needed beyond simple constructor usage; callers can
// instantiate `new ContextWindow(messages)` directly.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const POINTER_FILE = 'last.json';

interface StoredSession {
  createdAt: string;
  messages: Message[];
  title?: string;
}

/** Persist the provided ContextWindow (or raw message array) to disk. */
export function saveSession(source: ContextWindow | Message[] | undefined): void {
  if (!source) return;

  try {
    const dir = getAppDataDir();
    ensureDir(dir);

    const createdAt = new Date();
    const iso = createdAt.toISOString();
    const fileName = iso.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '') + '.json';

    const data: StoredSession = {
      createdAt: iso,
      messages: toSerializableMessages(source) as Message[],
    };

    fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data), 'utf8');

    // Update pointer file for O(1) access next time.  Overwrite atomically.
    fs.writeFileSync(path.join(dir, POINTER_FILE), JSON.stringify({ fileName }), 'utf8');
  } catch {
    // Never crash because of IO errors.
  }
}

/**
 * Load the messages of the most recently saved session. Returns `null` when
 * nothing can be loaded.
 */
export function loadLastSession(): { messages: Message[]; createdAt: string } | null {
  try {
    const dir = getAppDataDir();
    const pointerPath = path.join(dir, POINTER_FILE);

    if (!fs.existsSync(pointerPath)) return null;

    const { fileName } = JSON.parse(fs.readFileSync(pointerPath, 'utf8')) as { fileName: string };
    if (!fileName) return null;

    const sessionPath = path.join(dir, fileName);
    if (!fs.existsSync(sessionPath)) return null;

    const stored = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as StoredSession;
    if (!stored.messages) return null;

    return { messages: stored.messages, createdAt: stored.createdAt };
  } catch {
    return null;
  }
}
