# Multi-Repository AI Agents: Atomic Rollback Across Codebases

_Extending invisible checkpointing to handle complex development environments with multiple interconnected repositories_

---

In our [previous post](./01-checkpointing-and-rollback.md), we explored how shadow repositories enable safe autonomous AI agents through invisible checkpointing. But that solution only worked for single repositories - and modern development rarely happens in isolation.

Consider a typical microservices development environment where an AI agent needs to implement a feature spanning multiple repositories:

```
/home/user/projects/
├── frontend/              # React application
├── backend-api/           # Node.js API server
├── shared-components/     # Shared component library
├── deployment-config/     # Kubernetes configurations
└── documentation/         # API documentation
```

When the agent implements a new feature, it might:

1. Add a new API endpoint in `backend-api/`
2. Create a new shared component in `shared-components/`
3. Use that component in `frontend/`
4. Update deployment configs in `deployment-config/`
5. Document the feature in `documentation/`

Now imagine the human reviewer decides the approach was wrong after step 3. Rolling back only the frontend changes leaves the environment in a broken state - the frontend expects components that no longer exist, the API has endpoints that aren't used, and the documentation doesn't match reality.

**The core problem**: We need atomic consistency across multiple repositories. Either all repositories rollback together, or none do.

## Detecting Multi-Repository Environments

Our first challenge was detecting which repositories exist in a development environment. We built a `MultiRepoManager` that scans a configurable projects directory:

```typescript
class MultiRepoManager {
  constructor(private projectsRoot: string) {}

  async scanForRepos(adapter: ExecutionAdapter): Promise<string[]> {
    // Check if projectsRoot itself is a git repository (single-repo mode)
    if (await this.isGitRepo(this.projectsRoot, adapter)) {
      return [this.projectsRoot];
    }

    // Multi-repo mode: scan child directories for git repositories
    const lsResult = await adapter.executeCommand(
      'scan-repos',
      `find "${this.projectsRoot}" -maxdepth 1 -type d 2>/dev/null || true`,
    );

    const repos: string[] = [];
    for (const dir of lsResult.stdout.split('\n').filter(Boolean)) {
      if (await this.isGitRepo(dir, adapter)) {
        repos.push(dir);
      }
    }

    return repos;
  }

  private async isGitRepo(dirPath: string, adapter: ExecutionAdapter): Promise<boolean> {
    try {
      const result = await adapter.executeCommand(
        'check-git',
        `test -d "${dirPath}/.git" && echo "true" || echo "false"`,
      );
      return result.stdout.trim() === 'true' && result.exitCode === 0;
    } catch (error) {
      return false;
    }
  }
}
```

This gracefully handles both single-repository projects (where the projects root itself is the repo) and multi-repository environments (where child directories are individual repos).

We cache the repository list for 30 seconds to avoid repeated filesystem scans:

```typescript
private repoCache: string[] | null = null;
private cacheTimestamp: number = 0;
private readonly cacheExpiryMs = 30000; // 30 seconds

async scanForRepos(adapter: ExecutionAdapter): Promise<string[]> {
  const now = Date.now();
  if (this.repoCache && (now - this.cacheTimestamp) < this.cacheExpiryMs) {
    return this.repoCache;
  }

  // Scan and update cache...
}
```

## Multi-Repository Shadow Architecture

For each repository detected, we create the same shadow repository structure as the single-repo case:

```
/home/user/projects/
├── frontend/
│   ├── .git/                     # Frontend's normal git
│   ├── .agent-shadow/
│   │   └── session-abc123/       # Frontend's shadow git
│   └── src/
├── backend-api/
│   ├── .git/                     # Backend's normal git
│   ├── .agent-shadow/
│   │   └── session-abc123/       # Backend's shadow git
│   └── src/
└── shared-components/
    ├── .git/                     # Components' normal git
    ├── .agent-shadow/
    │   └── session-abc123/       # Components' shadow git
    └── src/
```

Each repository gets its own shadow repository with the same session ID, but they're completely independent git databases. The session ID ties them together conceptually but they don't share any git data.

## Atomic Multi-Repository Checkpointing

The key insight for multi-repository checkpointing is that **every state-changing operation checkpoints ALL repositories**, regardless of which one actually changed.

When an agent edits a file in the frontend repository, we checkpoint frontend, backend-api, shared-components, deployment-config, AND documentation repositories. This might seem wasteful, but it ensures atomic consistency.

### Data Structure Evolution

Our checkpoint metadata was designed from the start to support multiple repositories:

```typescript
// From CheckpointManager.ts - handles both single and multi-repo
interface SnapshotMeta {
  sessionId: string;
  toolExecutionId: string;
  hostCommits: Map<string, string>; // repo path -> current commit SHA
  reason: 'writeFile' | 'editFile' | 'bash' | string;
  timestamp: string; // ISO-8601
}

interface SnapshotResult {
  repoSnapshots: Map<string, { sha: string; bundle: Uint8Array }>;
  aggregateSnapshot: {
    toolExecutionId: string;
    timestamp: string;
    repoCount: number;
  };
}
```

The key insight is using `hostCommits` as a Map that tracks the current state of each repository when the checkpoint is created. For single-repository projects, this Map simply contains one entry.

### The Multi-Repository Snapshot Process

When a state-changing operation occurs anywhere in the environment:

```typescript
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
      // Get the host commit for this repository
      const hostCommit = meta.hostCommits.get(repoPath) || 'HEAD';

      // Create single-repo snapshot metadata for this repository
      const singleRepoMeta: SnapshotMeta = {
        sessionId: meta.sessionId,
        toolExecutionId: meta.toolExecutionId,
        hostCommits: new Map([[repoPath, hostCommit]]),
        reason: meta.reason,
        timestamp: meta.timestamp,
      };

      // Create snapshot for this repository using existing single-repo logic
      const result = await snapshot(singleRepoMeta, adapter, repoPath);
      repoSnapshots.set(repoPath, result);
    } catch (error) {
      const errorMsg = `Failed to create snapshot for ${repoPath}: ${error.message}`;
      errors.push(errorMsg);
      console.warn(errorMsg);
      // Continue with other repositories even if one fails
    }
  }

  // Fail only if ALL repositories failed
  if (repoSnapshots.size === 0) {
    throw new Error(`All repository snapshots failed: ${errors.join('; ')}`);
  }

  // Log warnings for partial failures
  if (errors.length > 0) {
    console.warn(
      `Multi-repo snapshot completed with ${errors.length} failures: ${errors.join('; ')}`,
    );
  }

  return {
    repoSnapshots,
    aggregateSnapshot: {
      toolExecutionId: meta.toolExecutionId,
      timestamp: meta.timestamp,
      repoCount: repoSnapshots.size,
    },
  };
}
```

Key design decisions:

1. **Graceful degradation**: If individual repositories fail to checkpoint, we continue with the others
2. **Fail fast only on total failure**: Only throw an error if ALL repositories fail to checkpoint
3. **Reuse single-repo logic**: Each repository uses the existing `snapshot()` function internally

## Multi-Repository Rollback

Rolling back in multi-repository environments requires restoring ALL repositories to their state at the target checkpoint:

```typescript
// From RollbackManager
async rollback(targetMessageId: string): Promise<void> {
  // 1. Set abort signal to halt in-flight operations
  this.abortController.abort();
  this.emit(AgentEventType.ABORT_SESSION, { sessionId: this.sessionId });

  // 2. Find the target checkpoint
  const targetMessage = this.contextWindow.findMessage(targetMessageId);
  if (!targetMessage?.lastCheckpointId) {
    throw new Error('Cannot rollback: target message has no associated checkpoint');
  }

  // 3. Get all repositories and restore each one
  const repos = await this.multiRepoManager.scanForRepos(this.adapter);

  // Restore each repo in parallel
  await Promise.all(repos.map(repoPath =>
    CheckpointManager.restore(
      this.sessionId,
      this.adapter,
      repoPath,
      targetMessage.lastCheckpointId!
    )
  ));

  // 4. Trim conversation context
  this.contextWindow.rollbackToMessage(targetMessageId);

  // 5. Emit completion event
  this.emit(AgentEventType.ROLLBACK_COMPLETED, {
    sessionId: this.sessionId,
    checkpointId: targetMessage.lastCheckpointId,
    repositoryCount: repos.length
  });
}
```

The parallel restoration is crucial for performance - with 5 repositories, we don't want to wait 5x as long for rollback.

Each repository's restoration uses the same single-repo restore logic:

```bash
# For each repository, restore to the tagged checkpoint
git --git-dir=".agent-shadow/session-abc123" rev-parse chkpt/exec-456  # Get commit SHA
git --git-dir=".agent-shadow/session-abc123" --work-tree="." checkout -f a1b2c3d4
```

## Performance Optimization

Our initial implementation processed repositories sequentially, which was unacceptably slow. We moved to parallel processing while maintaining error isolation:

```typescript
// Process all repositories in parallel
const repoInfos = await Promise.all(
  repos.map(async repoPath => {
    try {
      return await this.gitInfoHelper.getGitRepositoryInfo(async command => {
        // Change to specific repository directory before running git commands
        const repoCommand = `cd "${repoPath}" && ${command}`;
        const result = await this.sandbox.commands.run(repoCommand);
        return result;
      }, repoPath);
    } catch (error) {
      this.logger?.warn(`Error getting git info for ${repoPath}:`, error);
      return null;
    }
  }),
);

// Filter out failed repositories
return repoInfos.filter((info): info is GitRepositoryInfo => info !== null);
```

This reduced checkpoint time from `O(repositories)` to `O(1)` in most cases, since git operations are typically I/O bound and can run concurrently.

## Execution Adapter Integration

Multi-repository support required updating all execution adapters to be repository-aware. The interface evolved to return arrays instead of single objects:

```typescript
interface ExecutionAdapter {
  // Changed from single object to array
  getGitRepositoryInfo(): Promise<GitRepositoryInfo[]>;

  // New method for multi-repo directory structures
  getDirectoryStructures(): Promise<Map<string, string>>;
}
```

### E2B Remote Sandbox Implementation

For remote sandbox environments (E2B), repository detection happens inside the sandbox:

```typescript
async getGitRepositoryInfo(): Promise<GitRepositoryInfo[]> {
  try {
    // Scan for repositories in the remote environment
    const repos = await this.multiRepoManager.scanForRepos(this);

    // Get git info for each repository in parallel
    const repoInfos = await Promise.all(
      repos.map(async (repoPath) => {
        try {
          return await this.gitInfoHelper.getGitRepositoryInfo(async (command) => {
            // Run git commands in the specific repository directory
            const sandboxCommand = `cd "${repoPath}" && ${command}`;
            const result = await this.sandbox.commands.run(sandboxCommand);
            return result;
          }, repoPath);
        } catch (error) {
          this.logger?.warn(`Error getting git info for ${repoPath}:`, error);
          return null;
        }
      })
    );

    // Filter out any null results and return
    return repoInfos.filter((info): info is GitRepositoryInfo => info !== null);
  } catch (error) {
    this.logger?.error('Error retrieving git repository information:', error);
    return [];
  }
}
```

The key insight is that each repository needs its own execution context - we change directory (`cd`) before running git commands to ensure they operate on the correct repository.

## System Prompt Integration

Multi-repository environments create a challenge: how do you provide context about multiple codebases without overwhelming the AI model's context window?

We developed a summarized approach for multi-repo environments:

```typescript
async buildMultiRepoContext(repos: GitRepositoryInfo[]): Promise<string> {
  if (repos.length === 1) {
    // Single repo mode - use existing detailed format
    return this.buildSingleRepoContext(repos[0]);
  }

  // Multi-repo mode - summarized format
  let context = `=== Working Directory: ${this.projectsRoot} ===\n\n`;

  for (const [index, repo] of repos.entries()) {
    const repoName = repo.repoRoot.split('/').pop() || repo.repoRoot;

    context += `=== Repository ${index + 1}: ${repoName} ===\n`;
    context += `Path: ${repo.repoRoot}\n`;
    context += `Branch: ${repo.currentBranch}\n`;
    context += `Status: ${repo.status.type}\n`;

    if (repo.status.type === 'dirty') {
      context += `Modified: ${repo.status.modifiedFiles.length} files\n`;
    }

    context += '\n';
  }

  // Limit detail for performance
  if (repos.length > 3) {
    context += `[${repos.length - 3} additional repositories in ${this.projectsRoot}]\n`;
  }

  return context;
}
```

This gives the AI agent essential information about all repositories while keeping context manageable.

## Real-World Multi-Repository Workflow

Here's how the complete workflow works with multiple repositories:

### 1. Agent Working Across Repositories

```
Message 1: "I'll add user profile features"
  ↳ Checkpoint: exec-100 (before starting, all 5 repos at initial state)

Message 2: "Added User model to backend API"
  ↳ Checkpoint: exec-101 (before next operation, includes backend changes)

Message 3: "Created ProfileCard component"
  ↳ Checkpoint: exec-102 (before next operation, includes component creation)

Message 4: "Integrated ProfileCard in frontend"
  ↳ Checkpoint: exec-103 (before next operation, includes frontend integration)

Message 5: "Updated deployment to expose new endpoints"
  ↳ Checkpoint: exec-104 (before next operation, includes deployment changes)
```

Each checkpoint captures the state of ALL repositories before the next operation runs. This ensures we can always rollback to a consistent state across all repositories.

### 2. Human Review and Rollback

The human reviews and decides the ProfileCard component design was wrong. They want to rollback to Message 2 and try a different component approach.

```typescript
// Rollback to after backend changes but before component creation
await rollbackManager.rollback('message-2-id');
```

This atomically restores ALL repositories to their state when checkpoint exec-101 was taken (right before Message 3's operation):

- `backend-api/` includes the User model from Message 2
- `shared-components/` has no ProfileCard (it hadn't been created yet)
- `frontend/` has no ProfileCard integration (it hadn't been done yet)
- `deployment-config/` has no new endpoints (they hadn't been added yet)
- `documentation/` is at its original state

The environment is now in a consistent state where the backend has the User model but no subsequent cross-repository changes have occurred.

### 3. Agent Continues on New Path

```
Message 2: "Added User model to backend API" (preserved at exec-101 checkpoint)

Message 6: "Let's create a simpler UserInfo component instead"
  ↳ Checkpoint: exec-105 (before operation, includes new component approach)

Message 7: "Integrated UserInfo in frontend dashboard"
  ↳ Checkpoint: exec-106 (before next operation, includes frontend integration)
```

## Edge Cases and Production Lessons

### Repository Discovery Challenges

**Mixed Workspaces**: Real development environments contain git repos alongside non-git directories:

```bash
/home/user/projects/
├── frontend/           # Git repository ✓
├── backend-api/        # Git repository ✓
├── temp-files/         # Regular directory ✗
├── node_modules/       # Regular directory ✗
└── shared-components/  # Git repository ✓
```

Our `isGitRepo()` check handles this gracefully by testing for `.git` directory existence.

**Permission Issues**: Some directories might not be readable. Our implementation continues scanning other directories:

```typescript
try {
  const result = await adapter.executeCommand('check-git', `test -d "${dirPath}/.git"`);
  return result.exitCode === 0;
} catch (error) {
  // Directory not accessible - skip it
  return false;
}
```

### Partial Checkpoint Failures

In production, individual repositories sometimes fail to checkpoint (disk space, permissions, etc.). Our design continues with successful repositories rather than failing entirely:

```typescript
// Log warnings but don't fail the operation
if (errors.length > 0) {
  console.warn(
    `Multi-repo snapshot completed with ${errors.length} failures: ${errors.join('; ')}`,
  );
}
```

This prioritizes availability over strict consistency - it's better to have most repositories checkpointed than none.

### Storage Scaling

Multi-repository environments significantly increase storage requirements. Five repositories generate roughly 5x the checkpoint data. We mitigate this with:

1. **Shared git objects**: Each shadow repository uses `--shared` when cloning, minimizing disk usage
2. **Bundle compression**: Git bundles are already compressed, reducing storage overhead
3. **Retention policies**: Cleanup old checkpoints to prevent unbounded growth

## Why This Architecture Works

### Atomic Consistency

The most important property is that rollback works atomically across all repositories. Humans never see inconsistent states where some repositories are rolled back and others aren't.

### Development Workflow Preservation

Each repository maintains its own normal git workflow. Developers can commit, branch, and collaborate normally - the shadow repositories are completely invisible.

### Session Isolation and Persistence

Multiple developers can run multi-repo agents simultaneously:

```
/home/user/projects/
├── frontend/
│   ├── .agent-shadow/
│   │   ├── session-alice-123/
│   │   ├── session-bob-456/
│   │   └── session-charlie-789/
```

Each agent session gets its own shadow repositories across all detected repos. However, since sandboxes are ephemeral and get destroyed before human review, the critical data lives in git bundles stored on our server. When a human wants to review multi-repository work, we:

1. **Spin up a fresh sandbox** with the same repository layout
2. **Restore all shadow repositories** from stored bundles across all repos
3. **Enable atomic rollback** to any point in the original cross-repository session

This separation of ephemeral execution environments from persistent session state enables scalable multi-repository agent workflows.

### Graceful Scaling

The system handles anywhere from 1 to N repositories with the same architecture. Single-repository projects use the same code paths as multi-repository environments.

## Conclusion

Multi-repository checkpointing required extending our single-repository architecture around three key principles:

1. **Atomic consistency is non-negotiable** - partial rollbacks create more problems than they solve
2. **Graceful degradation beats strict consistency** - better to have most repositories working than none
3. **Repository independence with session coordination** - each repo has its own shadow git but shares session lifecycle

The ephemeral nature of sandboxes makes git bundles even more critical in multi-repository environments. When an agent works across 5 repositories and the sandbox gets destroyed, we need to reliably restore all 5 shadow repositories in a fresh environment to enable human review and rollback.

The result enables autonomous AI agents to work safely across complex multi-repository environments while maintaining the same human oversight guarantees as single-repository projects - even when the original execution environment no longer exists.

For AI agents working on real-world codebases, multi-repository support isn't optional infrastructure - it's essential for handling the complexity of modern development environments.

---

_The invisible checkpointing system now handles both single and multi-repository environments transparently, enabling AI agents to work across any development setup while preserving the clean git workflow developers expect._
