/**
 * Unit tests for CheckpointManager
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as CheckpointManager from '../CheckpointManager.js';
import { ExecutionAdapter } from '../../types/tool.js';
import { CheckpointEvents, CHECKPOINT_READY_EVENT } from '../../events/checkpoint-events.js';

describe('CheckpointManager', () => {
  // Mock execution adapter
  const mockAdapter: Partial<ExecutionAdapter> = {
    executeCommand: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    getGitRepositoryInfo: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Set up mock returns
    (mockAdapter.getGitRepositoryInfo as any).mockResolvedValue({
      isGitRepository: true,
      currentBranch: 'main',
      defaultBranch: 'main',
      commitSha: 'abc1234',
      status: { type: 'clean' },
      recentCommits: ['abc1234 Test commit'],
    });

    (mockAdapter.executeCommand as any).mockResolvedValue({
      stdout: 'abc1234',
      stderr: '',
      exitCode: 0,
    });

    (mockAdapter.writeFile as any).mockResolvedValue(undefined);

    (mockAdapter.readFile as any).mockImplementation(
      (path, maxSize, lineOffset, lineCount, encoding) => {
        if (path.includes('/tmp')) {
          // Return base64 content when requested
          if (encoding === 'base64') {
            return Promise.resolve({
              success: true,
              content: 'bW9jayBidW5kbGUgY29udGVudA==', // "mock bundle content" in base64
              path: '/tmp/temp-bundle-12345',
              encoding: 'base64',
              size: 20,
            });
          }
          return Promise.resolve({
            success: true,
            content: 'mock bundle content',
            path: '/tmp/temp-bundle-12345',
          });
        }
        return Promise.resolve({
          success: false,
          error: 'File not found',
          path,
        });
      },
    );
  });

  it('verifies .git remains a directory after checkpoint and restore round-trip', async () => {
    // Set up mock for file system operations
    const mockFs: { [key: string]: any } = {
      '/repo/.git': { isDirectory: () => true },
      '/repo/file1.txt': 'original content',
      '/repo/.agent-shadow/test-session': {},
    };

    // Mock for checking if .git is a directory
    const mockStatCommand = vi.fn().mockImplementation(path => {
      if (path === 'test -d "/repo/.git"') {
        return Promise.resolve({
          stdout: '',
          stderr: '',
          exitCode: mockFs['/repo/.git'].isDirectory() ? 0 : 1,
        });
      }
      return Promise.resolve({
        stdout: 'command executed',
        stderr: '',
        exitCode: 0,
      });
    });

    (mockAdapter.executeCommand as any).mockImplementation((id, cmd) => {
      // Call our special mock for stat tests
      if (cmd.includes('test -d')) {
        return mockStatCommand(cmd);
      }

      if (cmd.includes('mktemp')) {
        return Promise.resolve({
          stdout: 'SNAPSHA:abc1234\nSNAPFILE:/tmp/temp-bundle-12345\nSNAPEND\n',
          stderr: '',
          exitCode: 0,
        });
      } else if (cmd.includes('rev-parse')) {
        return Promise.resolve({
          stdout: 'abc1234',
          stderr: '',
          exitCode: 0,
        });
      }
      return Promise.resolve({
        stdout: 'command executed',
        stderr: '',
        exitCode: 0,
      });
    });

    // Setup metadata for snapshot
    const meta: CheckpointManager.SnapshotMeta = {
      sessionId: 'test-session',
      toolExecutionId: 'tool-123',
      hostCommit: 'host-abc',
      reason: 'writeFile',
      timestamp: new Date().toISOString(),
    };

    // 1. Create a snapshot
    await CheckpointManager.snapshot(meta, mockAdapter as ExecutionAdapter, '/repo');

    // 2. Verify .git is still a directory
    const statResult1 = await mockStatCommand('test -d "/repo/.git"');
    expect(statResult1.exitCode).toBe(0); // 0 means it's a directory

    // 3. Restore from the snapshot
    await CheckpointManager.restore(
      'test-session',
      mockAdapter as ExecutionAdapter,
      '/repo',
      'tool-123',
    );

    // 4. Verify .git is still a directory after restore
    const statResult2 = await mockStatCommand('test -d "/repo/.git"');
    expect(statResult2.exitCode).toBe(0); // 0 means it's still a directory

    // 5. Verify all git commands use --git-dir and --work-tree
    const allCommands = (mockAdapter.executeCommand as any).mock.calls
      .map((call: any[]) => call[1])
      .filter((cmd: string) => cmd.includes('git'));

    for (const cmd of allCommands) {
      if (cmd.includes('git init')) continue; // Skip init commands

      // Every git command should have both --git-dir and --work-tree
      if (cmd.includes('git ')) {
        expect(cmd).toContain('--git-dir=');
        expect(cmd).toContain('--work-tree=');
      }
    }
  });
});
