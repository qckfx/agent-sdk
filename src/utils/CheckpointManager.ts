/**
 * CheckpointManager.ts
 * 
 * Provides session-scoped snapshot facilities that run inside any
 * ExecutionAdapter and expose completed snapshot bundles to upstream
 * consumers (the agent server).
 */

import { ExecutionAdapter } from '../types/tool.js';

// ---------------------------------------------------------------------------
// Utilities to keep the shadow repository out of the user's "git status"
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';

// Define interface for snapshot metadata (handles both single and multi-repo)
export interface SnapshotMeta {
  sessionId: string;
  toolExecutionId: string;
  hostCommits: Map<string, string>; // repo path -> commit sha
  reason: 'writeFile' | 'editFile' | 'bash' | string;
  timestamp: string; // ISO-8601
}

// Define interface for snapshot result (handles both single and multi-repo)
export interface SnapshotResult {
  repoSnapshots: Map<string, { sha: string; bundle: Uint8Array }>;
  aggregateSnapshot: {
    toolExecutionId: string;
    timestamp: string;
    repoCount: number;
  };
}

/**
 * Get the shadow git directory path for a given repo root and session ID
 */
const getShadowDir = (repoRoot: string, sessionId: string): string => {
  return `${repoRoot}/.agent-shadow/${sessionId}`;
};

/**
 * Build a git command with the correct --git-dir and --work-tree prefixes to target the shadow repo
 * 
 * This ensures we operate on the shadow repo without affecting the user's .git directory
 */
const gitCommand = (shadowDir: string, repoRoot: string, cmd: string): string => {
  return `git --git-dir="${shadowDir}" --work-tree="${repoRoot}" ${cmd}`;
};

/**
 * Ensure `.agent-shadow/` is ignored by the host repository so that it does
 * not appear in `git status`. This adds the pattern to `.git/info/exclude`, a
 * repo-local ignore file that is never committed.
 */
const ensureShadowDirIgnored = (repoRoot: string): void => {
  try {
    const gitDir = path.join(repoRoot, '.git');
    if (!fs.existsSync(gitDir)) return; // not a git repo

    const infoDir = path.join(gitDir, 'info');
    const excludePath = path.join(infoDir, 'exclude');

    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }

    const entry = '.agent-shadow/';
    if (fs.existsSync(excludePath)) {
      const text = fs.readFileSync(excludePath, 'utf8');
      if (text.includes(entry)) return; // already ignored
    }

    const comment = '# added by qckfx agent – ignore session shadow repository';
    fs.appendFileSync(excludePath, `\n${comment}\n${entry}\n`);
  } catch {
    // Silently ignore – inability to edit the exclude file is non-fatal.
  }
};

/**
 * Make a gitignore-style exclusion file for the shadow repo
 * Copies the host .gitignore and adds shadow-specific exclusions
 */
const makeExcludeFile = async (repoRoot: string, shadowDir: string, adapter: ExecutionAdapter): Promise<void> => {
  const executionId = 'cp-make-exclude-file';
  // Ensure the info directory exists
  await adapter.executeCommand(executionId, `mkdir -p "${shadowDir}/info"`);
  
  // Try to read the host .gitignore using cat to avoid line numbering
  let excludeContent = '';
  
  try {
    // Use cat to get raw content without line numbers 
    const catResult = await adapter.executeCommand(executionId, `cat "${repoRoot}/.gitignore" 2>/dev/null`);
    if (catResult.exitCode === 0) {
      excludeContent = catResult.stdout + '\n\n';
    }
  } catch (error) {
    // Ignore errors - .gitignore might not exist
  }
  
  // Add shadow-specific exclusions
  excludeContent += `
# Checkpoint exclusions
node_modules/
.git/
dist/
*.log
.agent-shadow/
`;
  
  // Write to the shadow repo's exclude file
  await adapter.writeFile(executionId, `${shadowDir}/info/exclude`, excludeContent);
};

/**
 * Initialize the checkpoint system for a session
 * 
 * @param repoRoot Path to the repository root
 * @param sessionId Unique identifier for the session
 * @param adapter Execution adapter to use for operations
 */
export async function init(
  repoRoot: string,
  sessionId: string,
  adapter: ExecutionAdapter,
): Promise<void> {
  // Make sure the host repo does not show .agent-shadow/ as an untracked dir
  ensureShadowDirIgnored(repoRoot);
  // Ensure we're in a git repo
  const gitInfoArray = await adapter.getGitRepositoryInfo();
  const gitInfo = gitInfoArray.find(info => info.repoRoot === repoRoot);
  if (!gitInfo || !gitInfo.isGitRepository) {
    throw new Error('Cannot initialize checkpoint system in non-git repository');
  }
  
  // Create shadow directory path
  const shadowDir = getShadowDir(repoRoot, sessionId);

  const executionId = 'cp-init';

  // ----------------------------------------------------------------------
  // Initialise the *shadow* repository in ONE shell invocation to minimise
  // process-spawn overhead (especially noticeable inside containers).
  // ----------------------------------------------------------------------

  const oneShotCmdParts = [
    // Create the parent directory (idempotent)
    `mkdir -p "${repoRoot}/.agent-shadow"`,

    // Clone the bare, shared shadow repo only if the session directory does
    // not exist yet.  "||" is intentional – we skip the clone when the dir
    // is already there from a previous run.
    `[ -d "${shadowDir}" ] || git clone --quiet --shared --no-hardlinks --depth 1 --bare "${repoRoot}" "${shadowDir}"`,

    // Configure author information (also idempotent)
    `git --git-dir="${shadowDir}" config user.email "checkpoint@example.com"`,
    `git --git-dir="${shadowDir}" config user.name "Checkpoint System"`,

    // ------------------------------------------------------------------
    // Set up the info/exclude file in one go – copy host .gitignore (if any)
    // and append our additional patterns.
    // ------------------------------------------------------------------
    `mkdir -p "${shadowDir}/info"`,

    // The subshell captures .gitignore (may be empty) and appends extra lines.
    `(` +
      `cat "${repoRoot}/.gitignore" 2>/dev/null || true;` +
      `echo;` +
      `echo '# Checkpoint exclusions';` +
      `echo 'node_modules/';` +
      `echo '.git/';` +
      `echo 'dist/';` +
      `echo '*.log';` +
      `echo '.agent-shadow/';` +
    `) > "${shadowDir}/info/exclude"`
  ];

  await adapter.executeCommand(executionId, oneShotCmdParts.join(' && '));
  
  // Exclude file already created by the one-shot command above.
  
  // We intentionally DO NOT create an initial commit here – doing so required
  // staging the entire work-tree which negated the speed-up we gain from the
  // shallow, shared clone.  The first call to `snapshot()` will create the
  // initial commit automatically.
}

/**
 * Create a snapshot of the current state
 * 
 * @param meta Metadata for the snapshot
 * @param adapter Execution adapter to use for operations
 * @param repoRoot Path to the repository root
 * @returns Object containing the commit SHA and git bundle as a Uint8Array
 */
export async function snapshot(
  meta: SnapshotMeta,
  adapter: ExecutionAdapter,
  repoRoot: string,
): Promise<{ sha: string; bundle: Uint8Array }> {
  const executionId = 'cp-snapshot';
  // Get shadow directory
  const shadowDir = getShadowDir(repoRoot, meta.sessionId);
  
  // Step 1: Add all files (using --git-dir/--work-tree pattern)
  // ---------------------------------------------------------------------
  // Snapshot via standalone shell script (scripts/snapshot.sh)
  // ---------------------------------------------------------------------

  const rawCommitMessage = `${meta.timestamp}::${JSON.stringify(meta)}`;
  // Escape single quotes so the entire message can be passed as one
  // single-quoted shell argument.
  const escapedMsg = rawCommitMessage.replace(/'/g, `'"'"'`);

  // Absolute path inside the container set by Dockerfile COPY
  const scriptPath = '/usr/local/bin/snapshot.sh';

  const command = `${scriptPath} "${shadowDir}" "${repoRoot}" '${escapedMsg}' "${meta.toolExecutionId}"`;

  const { stdout } = await adapter.executeCommand(executionId, command);

  const lines = stdout.split('\n');
  const shaLine = lines.find(l => l.startsWith('SNAPSHA:'));
  if (!shaLine) {
    // Attach up to the last 2000 characters of stdout for debugging so the
    // caller can see where the script aborted (step markers, git error, …)
    const tail = stdout.length > 2000 ? stdout.slice(-2000) : stdout;
    throw new Error(`Snapshot failed: SHA marker not found. Output tail:\n${tail}`);
  }
  const sha = shaLine.replace('SNAPSHA:', '').trim();

  // Retrieve the temp bundle path
  const fileLine = lines.find(l => l.startsWith('SNAPFILE:'));
  if (!fileLine) {
    const tail = stdout.length > 2000 ? stdout.slice(-2000) : stdout;
    throw new Error(`Snapshot failed: bundle file marker not found. Output tail:\n${tail}`);
  }
  const bundlePath = fileLine.replace('SNAPFILE:', '').trim();

  // Ensure the END marker is present (acts as sync point)
  if (!lines.includes('SNAPEND')) {
    const tail = stdout.length > 2000 ? stdout.slice(-2000) : stdout;
    throw new Error(`Snapshot failed: bundle end marker missing. Output tail:\n${tail}`);
  }

  // Read the temporary bundle file (base64-encoded) via the adapter. The
  // ExecutionAdapter.readFile implementation follows the standard ToolResult
  // convention:  `{ ok: true, data: { content: '...' } }` for success and
  // `{ ok: false, error: '...' }` for failure.  Older code expected the
  // non-existent `success` boolean and `content` property at the top level.
  //
  // To stay compatible with the current signature we map the returned object
  // to the new format and throw a descriptive error when the read fails.
  const readRes = await adapter.readFile(
      executionId,
      bundlePath,
      50 * 1024 * 1024, // 50 MB
      undefined,
      undefined,
      'base64'
  );

  if (!readRes || !readRes.ok) {
      throw new Error(
          `Snapshot failed: unable to read bundle file (${readRes?.error || 'unknown error'})`
      );
  }

  const bundleBuffer = Buffer.from(readRes.data.content, 'base64');

  // Clean-up temporary bundle file (best-effort)
  await adapter.executeCommand(executionId, `rm -f "${bundlePath}"`).catch(() => {});

  return { sha, bundle: new Uint8Array(bundleBuffer) };
}

/**
 * Restore the repository working tree to a specific checkpoint commit.
 *
 * The checkpoint commits live in the session‑scoped *shadow repository* that
 * mirrors the host worktree. Restoring copies the files from the shadow repo
 * to the worktree using git checkout with explicit work-tree path.
 *
 * NOTE:  This operation **will discard** any uncommitted modifications in the
 * worktree.  Callers are expected to checkpoint first if they might need to
 * recover those changes.
 *
 * @param sessionId  The session whose shadow repository should be used.
 * @param adapter    Execution adapter used to run git commands.
 * @param repoRoot   Absolute path to the host repository root.
 * @param toolExecutionId The tool execution ID to restore to (will be used to find the tag)
 * @returns          The commit SHA that was checked out.
 */
export async function restore(
  sessionId: string,
  adapter: ExecutionAdapter,
  repoRoot: string,
  toolExecutionId: string,
): Promise<string> {
  const executionId = 'cp-restore';

  // Determine the target revision – default to HEAD if none supplied
  const targetRef = `chkpt/${toolExecutionId}`;

  const shadowDir = getShadowDir(repoRoot, sessionId);

  // Resolve the ref to a full commit SHA for the return value
  const revParseRes = await adapter.executeCommand(
    executionId,
    gitCommand(shadowDir, repoRoot, `rev-parse ${targetRef}`),
  );
  if (revParseRes.exitCode !== 0) {
    throw new Error(`Unable to resolve checkpoint reference '${targetRef}': ${revParseRes.stderr}`);
  }
  const resolvedSha = revParseRes.stdout.trim();

  // Use checkout to restore the files into the work tree
  const checkoutRes = await adapter.executeCommand(
    executionId,
    gitCommand(shadowDir, repoRoot, `checkout -f ${resolvedSha}`),
  );
  if (checkoutRes.exitCode !== 0) {
    throw new Error(`Failed to restore checkpoint ${resolvedSha}: ${checkoutRes.stderr}`);
  }

  return resolvedSha;
}

// ---------------------------------------------------------------------------
// Multi-Repository Checkpoint Functions
// ---------------------------------------------------------------------------

/**
 * Initialize the checkpoint system for multiple repositories in a session
 * 
 * @param repoPaths Array of repository root paths
 * @param sessionId Unique identifier for the session
 * @param adapter Execution adapter to use for operations
 */
export async function initMultiRepo(
  repoPaths: string[],
  sessionId: string,
  adapter: ExecutionAdapter,
): Promise<void> {
  // Initialize each repository's checkpoint system
  for (const repoPath of repoPaths) {
    try {
      await init(repoPath, sessionId, adapter);
    } catch (error) {
      console.warn(`Failed to initialize checkpoint system for ${repoPath}:`, error);
      // Continue with other repositories even if one fails
    }
  }
}

/**
 * Create coordinated snapshots across multiple repositories
 * Uses --allow-empty to ensure each repository gets a checkpoint even if no changes exist
 * 
 * @param meta Multi-repo snapshot metadata
 * @param adapter Execution adapter to use for operations
 * @param repoPaths Array of repository root paths
 * @returns Multi-repo snapshot result with individual repo snapshots and aggregate info
 */
export async function snapshotMultiRepo(
  meta: SnapshotMeta,
  adapter: ExecutionAdapter,
  repoPaths: string[],
): Promise<SnapshotResult> {
  const repoSnapshots = new Map<string, { sha: string; bundle: Uint8Array }>();
  const errors: string[] = [];

  // Create snapshots for each repository
  for (const repoPath of repoPaths) {
    try {
      // Get the host commit for this repository (if it exists in meta)
      const hostCommit = meta.hostCommits.get(repoPath) || 'HEAD';
      
      // Create single-repo snapshot metadata
      const singleRepoMeta: SnapshotMeta = {
        sessionId: meta.sessionId,
        toolExecutionId: meta.toolExecutionId,
        hostCommits: new Map([[repoPath, hostCommit]]),
        reason: meta.reason,
        timestamp: meta.timestamp
      };
      
      // Create snapshot for this repository
      const result = await snapshot(singleRepoMeta, adapter, repoPath);
      repoSnapshots.set(repoPath, result);
      
    } catch (error) {
      const errorMsg = `Failed to create snapshot for ${repoPath}: ${(error as Error).message}`;
      errors.push(errorMsg);
      console.warn(errorMsg);
      // Continue with other repositories even if one fails
    }
  }

  // If all repositories failed, throw an error
  if (repoSnapshots.size === 0) {
    throw new Error(`All repository snapshots failed: ${errors.join('; ')}`);
  }

  // Log warnings for any failed repositories
  if (errors.length > 0) {
    console.warn(`Multi-repo snapshot completed with ${errors.length} failures: ${errors.join('; ')}`);
  }

  return {
    repoSnapshots,
    aggregateSnapshot: {
      toolExecutionId: meta.toolExecutionId,
      timestamp: meta.timestamp,
      repoCount: repoSnapshots.size,
    }
  };
}

/**
 * Restore multiple repositories to specific checkpoint commits
 * 
 * @param sessionId The session whose shadow repositories should be used
 * @param adapter Execution adapter used to run git commands
 * @param repoPaths Array of repository root paths to restore
 * @param toolExecutionId The tool execution ID to restore to
 * @returns Map of repository paths to commit SHAs that were checked out
 */
export async function restoreMultiRepo(
  sessionId: string,
  adapter: ExecutionAdapter,
  repoPaths: string[],
  toolExecutionId: string,
): Promise<Map<string, string>> {
  const restoredCommits = new Map<string, string>();
  const errors: string[] = [];

  // Restore each repository
  for (const repoPath of repoPaths) {
    try {
      const commitSha = await restore(sessionId, adapter, repoPath, toolExecutionId);
      restoredCommits.set(repoPath, commitSha);
    } catch (error) {
      const errorMsg = `Failed to restore ${repoPath}: ${(error as Error).message}`;
      errors.push(errorMsg);
      console.warn(errorMsg);
      // Continue with other repositories even if one fails
    }
  }

  // If all repositories failed, throw an error
  if (restoredCommits.size === 0) {
    throw new Error(`All repository restores failed: ${errors.join('; ')}`);
  }

  // Log warnings for any failed repositories
  if (errors.length > 0) {
    console.warn(`Multi-repo restore completed with ${errors.length} failures: ${errors.join('; ')}`);
  }

  return restoredCommits;
}