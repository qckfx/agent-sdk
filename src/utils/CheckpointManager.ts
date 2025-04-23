/**
 * CheckpointManager.ts
 * 
 * Provides session-scoped snapshot facilities that run inside any
 * ExecutionAdapter and expose completed snapshot bundles to upstream
 * consumers (the agent server).
 */

import { ExecutionAdapter } from '../types/tool.js';

// Define interface for snapshot metadata
export interface SnapshotMeta {
  sessionId: string;
  toolExecutionId: string;
  hostCommit: string;
  reason: 'writeFile' | 'editFile' | 'bash' | string;
  timestamp: string; // ISO-8601
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
  // Ensure we're in a git repo
  const gitInfo = await adapter.getGitRepositoryInfo();
  if (!gitInfo || !gitInfo.isGitRepository) {
    throw new Error('Cannot initialize checkpoint system in non-git repository');
  }
  
  // Create shadow directory path
  const shadowDir = getShadowDir(repoRoot, sessionId);

  const executionId = 'cp-init';
  
  // Initialize a new bare git repository for our shadow
  await adapter.executeCommand(executionId, `mkdir -p "${repoRoot}/.agent-shadow/${sessionId}"`);
  
  // Create a bare repo instead of using --separate-git-dir
  await adapter.executeCommand(executionId, `git init --bare "${shadowDir}"`);
  
  // Set up git identity in the shadow repo
  await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `config user.email "checkpoint@example.com"`));
  await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `config user.name "Checkpoint System"`));
  
  // Create exclude file
  await makeExcludeFile(repoRoot, shadowDir, adapter);
  
  // Create initial commit if needed - check if HEAD exists
  const result = await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `rev-parse --quiet --verify HEAD`));
  if (result.exitCode !== 0) {
    // Empty repo, needs initial commit
    await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `add -A .`));
    await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `commit --allow-empty -m "Initial commit for checkpoint system"`));
  }
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
  await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `add -A .`));
  
  // Step 2: Create a commit with metadata in the message
  const commitMessage = `${meta.timestamp}::${JSON.stringify(meta)}`;
  await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `commit --allow-empty -m "${commitMessage}"`));
  
  // Step 3: Tag the commit
  await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `tag -f chkpt/${meta.toolExecutionId} HEAD`));
  
  // Step 4: Get the SHA
  const shaResult = await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `rev-parse HEAD`));
  const sha = shaResult.stdout.trim();
  
  // Step 5: Create bundle in a temp file with cross-platform compatibility
  // Try different mktemp variants for maximum portability (macOS, Linux, etc.)
  const tmpCmd = 'mktemp 2>/dev/null || mktemp -t bundle';
  const { stdout } = await adapter.executeCommand(executionId, tmpCmd);
  const bundlePath = stdout.trim();
  
  await adapter.executeCommand(executionId, gitCommand(shadowDir, repoRoot, `bundle create "${bundlePath}" --all`));
  
  // Step 6: Read the bundle file with base64 encoding (for greater reliability)
  const readResult = await adapter.readFile(executionId, bundlePath, undefined, undefined, undefined, 'base64');
  if (!readResult.success) {
    throw new Error(`Failed to read bundle file: ${readResult.error}`);
  }
  
  // Convert the base64 content to Uint8Array
  const contentStr = readResult.content;
  const buffer = Buffer.from(contentStr, 'base64');
  const bundle = new Uint8Array(buffer);
  
  // Cleanup the temporary bundle file
  await adapter.executeCommand(executionId, `rm "${bundlePath}"`);
  
  return { sha, bundle };
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