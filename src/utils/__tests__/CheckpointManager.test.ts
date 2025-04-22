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
    getGitRepositoryInfo: vi.fn()
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
      recentCommits: ['abc1234 Test commit']
    });
    
    (mockAdapter.executeCommand as any).mockResolvedValue({
      stdout: 'abc1234',
      stderr: '',
      exitCode: 0
    });
    
    (mockAdapter.writeFile as any).mockResolvedValue(undefined);
    
    (mockAdapter.readFile as any).mockImplementation((path, maxSize, lineOffset, lineCount, encoding) => {
      if (path.includes('/tmp')) {
        // Return base64 content when requested
        if (encoding === 'base64') {
          return Promise.resolve({
            success: true,
            content: 'bW9jayBidW5kbGUgY29udGVudA==', // "mock bundle content" in base64
            path: '/tmp/temp-bundle-12345',
            encoding: 'base64',
            size: 20
          });
        }
        return Promise.resolve({
          success: true,
          content: 'mock bundle content',
          path: '/tmp/temp-bundle-12345'
        });
      }
      return Promise.resolve({
        success: false,
        error: 'File not found',
        path
      });
    });
  });

  it('init creates shadow repo with separate git dir', async () => {
    // Configure mock for commands
    (mockAdapter.executeCommand as any).mockImplementation((cmd) => {
      if (cmd.includes('mktemp')) {
        return Promise.resolve({
          stdout: '/tmp/temp-file-12345',
          stderr: '',
          exitCode: 0
        });
      } else if (cmd.includes('rev-parse --quiet --verify HEAD')) {
        return Promise.resolve({
          stdout: '',
          stderr: '',
          exitCode: 1 // HEAD doesn't exist yet
        });
      } else if (cmd.includes('cat') && cmd.includes('.gitignore')) {
        return Promise.resolve({
          stdout: '# Host gitignore\nnode_modules\n*.log',
          stderr: '',
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: 'command executed',
        stderr: '',
        exitCode: 0
      });
    });
    
    await CheckpointManager.init('/repo', 'test-session', mockAdapter as ExecutionAdapter);
    
    // Verify git repository was checked
    expect(mockAdapter.getGitRepositoryInfo).toHaveBeenCalled();
    
    // Verify shadow git directory was created correctly
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('git init --separate-git-dir="/repo/.agent-shadow/test-session"')
    );
    
    // Verify core.worktree was set
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('config core.worktree')
    );
    
    // Verify git identity was set
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('config user.email')
    );
    
    // Verify info directory was created
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('mkdir -p "/repo/.agent-shadow/test-session/info"')
    );
    
    // Verify exclude file was created
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('cat "/repo/.gitignore"')
    );
    expect(mockAdapter.writeFile).toHaveBeenCalledWith(
      '/repo/.agent-shadow/test-session/info/exclude',
      expect.stringContaining('# Host gitignore')
    );
    
    // Verify initial commit was created (since HEAD didn't exist)
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('git --git-dir="/repo/.agent-shadow/test-session" commit --allow-empty')
    );
  });

  it('snapshot uses shadow repo for operations and returns SHA and bundle', async () => {
    // Set up mock for git commands and mktemp
    (mockAdapter.executeCommand as any).mockImplementation((cmd) => {
      if (cmd.includes('mktemp')) {
        return Promise.resolve({
          stdout: '/tmp/temp-bundle-12345',
          stderr: '',
          exitCode: 0
        });
      } else if (cmd.includes('rev-parse HEAD')) {
        return Promise.resolve({
          stdout: 'abc1234',
          stderr: '',
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: 'command executed',
        stderr: '',
        exitCode: 0
      });
    });
    
    // Set up an event listener to verify event emission
    const mockEventHandler = vi.fn();
    CheckpointEvents.on(CHECKPOINT_READY_EVENT, mockEventHandler);
    
    const meta: CheckpointManager.SnapshotMeta = {
      sessionId: 'test-session',
      toolExecutionId: 'tool-123',
      hostCommit: 'host-abc',
      reason: 'writeFile',
      timestamp: new Date().toISOString()
    };
    
    const result = await CheckpointManager.snapshot(meta, mockAdapter as ExecutionAdapter, '/repo');
    
    // Verify git commands were executed on the shadow repo
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('git --git-dir="/repo/.agent-shadow/test-session" add -A .')
    );
    
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('git --git-dir="/repo/.agent-shadow/test-session" commit')
    );
    
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('git --git-dir="/repo/.agent-shadow/test-session" tag -f')
    );
    
    // Verify cross-platform compatible temporary file generation
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringMatching(/mktemp.*2>\/dev\/null.*\|\|.*mktemp -t/)
    );
    
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('git --git-dir="/repo/.agent-shadow/test-session" bundle create')
    );
    
    // Verify bundle was read with base64 encoding
    expect(mockAdapter.readFile).toHaveBeenCalledWith(
      '/tmp/temp-bundle-12345', 
      undefined, 
      undefined, 
      undefined, 
      'base64'
    );
    
    // Verify cleanup
    expect(mockAdapter.executeCommand).toHaveBeenCalledWith('rm "/tmp/temp-bundle-12345"');
    
    // Check result format
    expect(result).toHaveProperty('sha');
    expect(result).toHaveProperty('bundle');
    expect(result.sha).toBe('abc1234');
    
    // Reset event handlers
    CheckpointEvents.removeAllListeners(CHECKPOINT_READY_EVENT);
  });
  
  it('validates base64 encoding from readFile produces decodable bundle', async () => {
    // Setup a mock for valid base64 content
    const validBase64 = 'U29tZSB2YWxpZCBiYXNlNjQgZW5jb2RlZCBjb250ZW50'; // "Some valid base64 encoded content"
    
    // Configure adapter to return valid base64
    (mockAdapter.executeCommand as any).mockImplementation((cmd) => {
      if (cmd.includes('mktemp')) {
        return Promise.resolve({
          stdout: '/tmp/temp-bundle-12345',
          stderr: '',
          exitCode: 0
        });
      } else if (cmd.includes('rev-parse HEAD')) {
        return Promise.resolve({
          stdout: 'abc1234',
          stderr: '',
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: 'command executed',
        stderr: '',
        exitCode: 0
      });
    });
    
    // Mock the readFile to return valid base64 content
    (mockAdapter.readFile as any).mockImplementation((path, maxSize, lineOffset, lineCount, encoding) => {
      if (path === '/tmp/temp-bundle-12345' && encoding === 'base64') {
        return Promise.resolve({
          success: true,
          path: '/tmp/temp-bundle-12345',
          content: validBase64,
          size: validBase64.length,
          encoding: 'base64'
        });
      }
      // Add a fallback for other readFile calls
      return Promise.resolve({
        success: false,
        error: 'File not found',
        path
      });
    });
    
    const meta: CheckpointManager.SnapshotMeta = {
      sessionId: 'test-session',
      toolExecutionId: 'tool-123',
      hostCommit: 'host-abc',
      reason: 'writeFile',
      timestamp: new Date().toISOString()
    };
    
    const result = await CheckpointManager.snapshot(meta, mockAdapter as ExecutionAdapter, '/repo');
    
    // Verify bundle is correctly decoded from base64
    expect(result.bundle).toBeInstanceOf(Uint8Array);
    
    // Decode the returned bundle back to text to validate correctness
    const decoded = Buffer.from(result.bundle).toString();
    
    // This should match our original content
    expect(decoded).toBe("Some valid base64 encoded content");
  });

  it('verifies tags are created in shadow repo and not in host repo', async () => {
    // Set up mock for commands
    const cmdCapture: string[] = [];
    (mockAdapter.executeCommand as any).mockImplementation((cmd) => {
      cmdCapture.push(cmd);
      
      if (cmd.includes('mktemp')) {
        return Promise.resolve({
          stdout: '/tmp/temp-bundle-12345',
          stderr: '',
          exitCode: 0
        });
      } else if (cmd.includes('rev-parse HEAD')) {
        return Promise.resolve({
          stdout: 'abc1234',
          stderr: '',
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: 'command executed',
        stderr: '',
        exitCode: 0
      });
    });
    
    const meta: CheckpointManager.SnapshotMeta = {
      sessionId: 'test-session',
      toolExecutionId: 'tool-123',
      hostCommit: 'host-abc',
      reason: 'writeFile',
      timestamp: new Date().toISOString()
    };
    
    await CheckpointManager.snapshot(meta, mockAdapter as ExecutionAdapter, '/repo');
    
    // Verify a command with 'tag' was executed and targets the shadow repo
    const tagCmd = cmdCapture.find(cmd => cmd.includes('tag -f'));
    expect(tagCmd).toBeDefined();
    expect(tagCmd).toContain('git --git-dir="/repo/.agent-shadow/test-session"');
    
    // Verify no git commands were executed on the host repo
    const hostRepoCommands = cmdCapture.filter(cmd => 
      cmd.includes('git') && !cmd.includes('--git-dir=')
    );
    expect(hostRepoCommands.length).toBe(0);
  });
});