# Safe Autonomous AI Agents: Why We Built Invisible Checkpointing

*How we enable human oversight of asynchronous AI agents without polluting git history*

---

Building AI agents that can work autonomously while maintaining human oversight requires solving a fundamental problem: **how do you let humans safely undo the agent's work?**

Consider this workflow: You deploy an AI agent to implement a feature across your codebase. The agent works asynchronously, making file edits, running tests, and iterating on the implementation. You review the work later and realize the agent took a wrong turn at step 3 out of 15. You want to rollback to that exact point and guide it in a different direction.

Simply removing messages from the conversation isn't enough - the agent has already modified files, created new ones, and potentially run commands that changed the environment. You need to rollback the actual state of the codebase, not just the conversation history.

The naive approach would be to commit every agent action to git, but this creates an unacceptable developer experience:

```bash
# What you DON'T want to see in your git history
commit abc123 - "Agent: Added logging to user service"
commit def456 - "Agent: Fixed typo in comment" 
commit ghi789 - "Agent: Reverted previous change"
commit jkl012 - "Agent: Tried different approach"
commit mno345 - "Agent: Debugging failed test"
# ... 47 more commits for a single feature
```

This pollutes your git history with intermediate work that wasn't intended for human consumption.

## Our Solution: Invisible Shadow Repositories

We built a checkpointing system that tracks every state-changing operation in invisible "shadow" git repositories that exist alongside your real codebase but never interfere with your normal git workflow.

### The Architecture

For every repository in your project, we create a session-scoped shadow repository:

```
your-repo/
├── .git/                    # Your normal git repository  
├── .agent-shadow/           # Shadow repository directory (invisible)
│   └── session-abc123/      # Session-scoped shadow git database
├── src/                     # Your source code (shared between both)
├── package.json             # (agent operates on real files)
└── README.md
```

The key insight is using git's `--git-dir` and `--work-tree` flags to operate on a separate git database while pointing to your actual files:

```bash
# This commits to shadow git but operates on your real files
git --git-dir=".agent-shadow/session-abc123" --work-tree="." add src/modified-file.ts
git --git-dir=".agent-shadow/session-abc123" --work-tree="." commit -m "checkpoint"
```

### Staying Invisible: The .git/info/exclude Trick

The critical detail is ensuring shadow repositories never appear in your normal git workflow. We use `.git/info/exclude` - a special git ignore file that's local to your repository and never committed:

```typescript
// Automatically called when initializing shadow repository
const ensureShadowDirIgnored = (repoRoot: string): void => {
  const excludePath = path.join(repoRoot, '.git/info/exclude');
  const entry = '.agent-shadow/';
  const comment = '# added by qckfx agent – ignore session shadow repository';
  
  // Add to .git/info/exclude (never committed, only local)
  fs.appendFileSync(excludePath, `\n${comment}\n${entry}\n`);
}
```

This is superior to modifying `.gitignore` because:
- It doesn't change any files under version control
- Developers never see it in `git status` or `git diff`
- Each developer can have agents running without affecting others
- No risk of committing agent-related changes accidentally

### When Checkpoints Are Created

Only three operations trigger automatic checkpoints:

1. **`writeFile`** - Creating or overwriting files
2. **`editFile`** - Modifying existing files  
3. **`executeCommand`** - Running shell commands (bash)

Read-only operations like `readFile`, `glob`, and `ls` don't create checkpoints since they don't change state. This prevents checkpoint spam while ensuring every meaningful change is captured.

### The Checkpointing Process

When a state-changing operation occurs:

```typescript
// 1. Agent makes a file edit
const result = await adapter.editFile('exec-123', 'src/user.ts', searchText, replaceText);

// 2. If successful, automatically create checkpoint
if (result.success) {
  await createCheckpoint('exec-123', 'editFile');
}
```

Inside `createCheckpoint()`:

```bash
# Add all current files to shadow repository
git --git-dir=".agent-shadow/session-abc" --work-tree="." add -A

# Create commit with --allow-empty (important for consistency)
git --git-dir=".agent-shadow/session-abc" --work-tree="." \
  commit --allow-empty -m "2024-01-15T10:30:00Z::checkpoint data"

# Tag for easy reference
git --git-dir=".agent-shadow/session-abc" tag "chkpt/exec-123"

# Create portable bundle for storage
git --git-dir=".agent-shadow/session-abc" bundle create \
  /tmp/bundle-exec-123.git --all
```

The `--allow-empty` flag is crucial - it ensures we get a checkpoint even when shell commands run but don't modify files.

## The Human Review and Rollback Workflow

Here's how the asynchronous review workflow works:

### 1. Agent Works Autonomously

```
Message 1: "I'll implement user authentication"
  ↳ Checkpoint: chkpt/exec-100 (agent reads existing code)
  
Message 2: "Created user model with validation"  
  ↳ Checkpoint: chkpt/exec-101 (agent wrote src/models/user.ts)
  
Message 3: "Added authentication middleware"
  ↳ Checkpoint: chkpt/exec-102 (agent wrote src/middleware/auth.ts)
  
Message 4: "Updated API routes to use auth"
  ↳ Checkpoint: chkpt/exec-103 (agent edited src/routes/api.ts)
  
Message 5: "Fixed type errors and ran tests"
  ↳ Checkpoint: chkpt/exec-104 (agent edited multiple files)
```

Each message stores the checkpoint ID that was current when the agent sent it:

```typescript
// From conversation.ts (simplified)
interface ConversationMessage {
  id: string;
  anthropic: Anthropic.Messages.MessageParam; // Actual message content
  createdAt: number;
  lastCheckpointId?: string;  // "exec-103" 
}
```

### 2. Human Reviews Later

The human reviews the conversation and codebase changes. They decide that Message 4 took the wrong approach - the API route changes aren't what they wanted.

### 3. Rollback to Specific Point

```typescript
// Human selects "rollback to message 3"
await rollbackManager.rollback('message-3-id');
```

This triggers:

```typescript
// 1. Stop any in-flight agent operations
this.abortController.abort();

// 2. Find target message's checkpoint
const targetMessage = this.findMessage('message-3-id');
const checkpointId = targetMessage.lastCheckpointId; // "exec-102"

// 3. Restore git state from shadow repository
await git.checkout(`chkpt/${checkpointId}`);

// 4. Remove messages after rollback point from conversation
this.contextWindow.rollbackToMessage('message-3-id');

// 5. Continue from this point
```

After rollback, the codebase is exactly as it was after Message 3. The agent can continue from there with different instructions.

### 4. Agent Continues on New Path

The human can now guide the agent in a different direction:

```
Message 3: "Added authentication middleware" (preserved)
  ↳ Checkpoint: chkpt/exec-102
  
Message 6: "Actually, update the frontend login form instead" (new direction)
  ↳ Checkpoint: chkpt/exec-105 (new checkpoint branch)
```

## Why This Architecture Works

### No Git History Pollution

Your actual git repository remains completely clean. When you're ready to commit the final result:

```bash
$ git status
Modified files:
  src/models/user.ts
  src/middleware/auth.ts
  src/components/login.tsx

$ git log --oneline -5
a1b2c3d Your previous commit before agent started
e4f5g6h Some other team member's work  
h7i8j9k Previous feature implementation
...

# No agent commits visible!
```

### Granular Human Control

Humans can rollback to any specific point in the agent's work, not just the beginning or end. This enables:

- **Surgical corrections**: Fix one bad decision without losing good work
- **Exploration**: Let the agent try multiple approaches, rollback and try again
- **Incremental approval**: Approve work step-by-step, rollback if something goes wrong

## Implementation Details

### Checkpoint Storage: Why Git Bundles?

We store checkpoints as git bundles - portable archives containing all git data:

```typescript
// From CheckpointManager.ts
interface SnapshotMeta {
  sessionId: string;
  toolExecutionId: string;
  hostCommits: Map<string, string>; // repo path -> commit sha
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

**Why bundles instead of keeping shadow repositories alive?** Because agent sandboxes are ephemeral.

The agent doesn't actually "live" in a sandbox - we just send bash commands to temporary containers that get spun up and torn down quickly. This makes deployment fast and cost-effective, but it means the sandbox (and its shadow repositories) will likely be destroyed long before a human reviews the work.

The bundle-based approach enables **session continuity across ephemeral environments**:

1. **Agent works in Sandbox A** → creates shadow repo → bundles checkpoint data
2. **Sandbox A gets destroyed** (cost optimization, resource cleanup, etc.)
3. **Human reviews work hours/days later** in a completely new environment
4. **System restores from bundles** → recreates shadow repos → enables rollback

Everything needed to restart a session lives in the session data stored on our server (or your own if self-hosting). When a human wants to review and potentially rollback agent work, we:

```typescript
// Restore session in fresh environment
const sessionData = await loadSessionData(sessionId);
for (const checkpoint of sessionData.checkpoints) {
  await restoreFromBundle(checkpoint.bundle, checkpoint.toolExecutionId);
}
// Human can now rollback to any point in the original session
```

This architecture separates **execution environments** (ephemeral, fast) from **session state** (persistent, reviewable).

### Performance Characteristics

- **Checkpoint creation**: ~50-100ms (mostly git bundle generation)
- **Rollback**: ~20-50ms (git checkout from existing repository)
- **Storage overhead**: ~5-10% additional disk usage (shared git objects)
- **Memory usage**: Minimal (bundles stored on disk)

### Error Handling

Checkpoints are created BEFORE operations to ensure consistency:

```typescript
// From CheckpointingExecutionAdapter
async editFile(executionId: string, filepath: string, searchCode: string, replaceCode: string) {
  // First take a checkpoint
  await this.cp(executionId, 'editFile');
  // Then execute the operation
  return await this.inner.editFile(executionId, filepath, searchCode, replaceCode);
}
```

If checkpoint creation fails, the operation never runs. This ensures the environment state and checkpoint state stay synchronized - we never have operations without corresponding checkpoints.

## When to Use This Pattern

This checkpointing approach is specifically designed for:

✅ **Asynchronous AI agents** that work autonomously and get reviewed later  
✅ **Experimental workflows** where agents try multiple approaches  
✅ **Code modification tasks** where wrong turns need surgical correction  
✅ **Multi-step processes** where humans want granular rollback control  

## Conclusion

Building trustworthy autonomous AI agents requires solving the human oversight problem. Our invisible checkpointing system enables the best of both worlds:

- **Agents can work freely** without worrying about making mistakes
- **Humans maintain full control** with granular rollback capabilities  
- **Developer experience stays clean** with no git history pollution

The key insight is that managing agent state requires infrastructure that's invisible to normal development workflows but powerful enough to handle complex rollback scenarios. Shadow repositories with `.git/info/exclude` provide exactly that capability.

---

*Next: How we extended this architecture to handle multiple repositories simultaneously - enabling agents to work across complex microservice environments while maintaining atomic rollback guarantees.*
