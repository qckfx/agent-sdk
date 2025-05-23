/**
 * GitInfoHelper - Optimized, cached git repository information retrieval
 * 
 * This helper centralizes git repository information retrieval with tiered caching:
 * - Static information (default branch, git directory) - cached per instance
 * - Commits cache - refreshed when HEAD changes or after time expires
 * - Working directory status - always checked in parallel
 */

import { GitRepositoryInfo, CleanRepositoryStatus, DirtyRepositoryStatus } from '../types/repository.js';
import { LogCategory } from './logger.js';

// Type for execution function that runs git commands
export type ExecuteCommandFn = (command: string) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

// Structure for static git repository cache
interface StaticGitCache {
  isGitRepository: boolean;
  defaultBranch: string;
  gitDir: string | null;
}

// Structure for commits cache
interface CommitsCache {
  recentCommits: string[];
  lastHeadCommit: string;
  timestamp: number;
}

export class GitInfoHelper {
  // Cache data
  private staticGitCache: StaticGitCache | null = null;
  private commitsCache: CommitsCache | null = null;
  
  // Logger reference for debug info
  private logger?: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  
  constructor(options?: { 
    logger?: {
      debug: (message: string, ...args: unknown[]) => void;
      info: (message: string, ...args: unknown[]) => void;
      warn: (message: string, ...args: unknown[]) => void;
      error: (message: string, ...args: unknown[]) => void;
    }
  }) {
    this.logger = options?.logger;
  }
  
  /**
   * Retrieves git repository information using optimized parallel execution
   * and instance-based caching
   * @param executeCommand Function to execute git commands
   * @returns Git repository information or null if not a git repository
   */
  async getGitRepositoryInfo(executeCommand: ExecuteCommandFn, repoPath: string): Promise<GitRepositoryInfo | null> {
    try {
      // Start by checking if this is a git repository (if not already cached)
      if (!this.staticGitCache) {
        const isGitRepoCmd = await executeCommand("git rev-parse --is-inside-work-tree 2>/dev/null || echo false");
        if (isGitRepoCmd.exitCode !== 0 || isGitRepoCmd.stdout.trim() !== 'true') {
          this.logger?.debug('Not a git repository', LogCategory.SYSTEM);
          
          // Cache the negative result
          this.staticGitCache = {
            isGitRepository: false,
            defaultBranch: '',
            gitDir: null
          };
          
          return null;
        }
        
        // IMPORTANT: Initialize static git info immediately
        // This runs only once per repository to cache stable information
        
        // Run these in parallel to determine default branch
        this.logger?.debug('Initializing static git info', LogCategory.SYSTEM);
        const [gitDirCmd, remoteCheckCmd, commonBranchCheckCmd] = await Promise.all([
          executeCommand("git rev-parse --git-dir 2>/dev/null"),
          executeCommand("git remote show origin 2>/dev/null | grep 'HEAD branch' | cut -d ':' -f 2 | xargs"),
          executeCommand("git for-each-ref --format='%(refname:short)' refs/heads/ | grep -E '^(main|master|trunk)$' | head -1")
        ]);
        
        const gitDir = gitDirCmd.stdout.trim();
        
        // Determine default branch from results
        let defaultBranch = remoteCheckCmd.stdout.trim();
        if (!defaultBranch) {
          defaultBranch = commonBranchCheckCmd.stdout.trim();
        }
        
        // Cache the static info - but not currentBranch which will be determined later
        // since that can change between invocations
        this.staticGitCache = {
          isGitRepository: true,
          defaultBranch,  // This may still be empty, but will be updated once we have currentBranch
          gitDir
        };
        
        this.logger?.debug(`Static git info cached: defaultBranch=${defaultBranch}, gitDir=${gitDir}`, LogCategory.SYSTEM);
      } else if (!this.staticGitCache.isGitRepository) {
        // Already checked and not a git repo
        return null;
      }
      
      // Optimistically execute all git commands in parallel for maximum performance
      // This includes both basic status and dirty repo details - we'll use what we need
      const [
        currentBranchCmd, 
        statusCmd, 
        headCmd,
        recentCommitsCmd,
        modifiedFilesCmd,
        stagedFilesCmd,
        untrackedFilesCmd,
        deletedFilesCmd
      ] = await Promise.all([
        // Basic repo info
        executeCommand("git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown"),
        executeCommand("git status --porcelain"),
        executeCommand("git rev-parse HEAD 2>/dev/null || echo ''"),
        executeCommand("git log -5 --pretty=format:'%h %s'"),
        
        // Dirty repo details (fetched optimistically regardless of clean status)
        executeCommand("git diff --name-only"),
        executeCommand("git diff --name-only --staged"),
        executeCommand("git ls-files --others --exclude-standard"),
        executeCommand("git ls-files --deleted")
      ]);
      
      // Process results
      const currentBranch = currentBranchCmd.stdout.trim();
      const statusOutput = statusCmd.stdout.trim();
      const isClean = statusOutput === '';
      const headCommit = headCmd.stdout.trim();
      
      // If we don't have a default branch yet, use current branch
      // This happens if the remote checks and common branch checks failed
      if (!this.staticGitCache.defaultBranch) {
        this.staticGitCache.defaultBranch = currentBranch || 'main';
        this.logger?.debug(`Default branch not found in remote, using: ${this.staticGitCache.defaultBranch}`, LogCategory.SYSTEM);
      }
      
      // Process recent commits
      let recentCommits: string[];
      
      // Check if we need to update commits cache - only based on HEAD changes
      if (!this.commitsCache || this.commitsCache.lastHeadCommit !== headCommit) {
        // HEAD has changed or no cache exists, need to update
        recentCommits = recentCommitsCmd.stdout.split('\n').filter(Boolean);
        
        // Update cache with timestamp for debugging purposes
        this.commitsCache = {
          recentCommits,
          lastHeadCommit: headCommit,
          timestamp: Date.now()
        };
        
        this.logger?.debug(`Updated commits cache with ${recentCommits.length} commits (HEAD: ${headCommit})`, LogCategory.SYSTEM);
      } else {
        // Use cached commits (HEAD hasn't changed)
        recentCommits = this.commitsCache.recentCommits;
        this.logger?.debug(`Using cached commits for HEAD: ${headCommit}`, LogCategory.SYSTEM);
      }
      
      // Build the final git info object
      let gitInfo: GitRepositoryInfo;
      
      if (isClean) {
        gitInfo = {
          repoRoot: repoPath,
          isGitRepository: true,
          currentBranch,
          defaultBranch: this.staticGitCache.defaultBranch,
          status: { type: 'clean' },
          recentCommits,
          commitSha: headCommit
        };
      } else {
        // Repository is dirty, use the already fetched details
        gitInfo = {
          repoRoot: repoPath,
          isGitRepository: true,
          currentBranch,
          defaultBranch: this.staticGitCache.defaultBranch,
          status: {
            type: 'dirty',
            modifiedFiles: modifiedFilesCmd.stdout.split('\n').filter(Boolean),
            stagedFiles: stagedFilesCmd.stdout.split('\n').filter(Boolean),
            untrackedFiles: untrackedFilesCmd.stdout.split('\n').filter(Boolean),
            deletedFiles: deletedFilesCmd.stdout.split('\n').filter(Boolean)
          },
          recentCommits,
          commitSha: headCommit
        };
      }
      
      return gitInfo;
    } catch (error) {
      this.logger?.error('Error retrieving git repository information:', error, LogCategory.SYSTEM);
      return null;
    }
  }
  
  /**
   * Clear all cached git information
   * Useful for testing or when switching directories
   */
  clearCache(): void {
    this.staticGitCache = null;
    this.commitsCache = null;
  }
}