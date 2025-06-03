/**
 * MultiRepoManager.ts
 *
 * Manages multiple git repositories in a projects directory.
 * Scans for repositories, maps files to repositories, and provides
 * utilities for multi-repo operations.
 */

import { ExecutionAdapter } from '../types/tool.js';
import path from 'path';

export class MultiRepoManager {
  private repoCache: string[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly cacheExpiryMs = 30000; // 30 seconds

  constructor(private projectsRoot: string) {}

  /**
   * Scan projectsRoot for git repositories
   * @param adapter Execution adapter to run commands
   * @returns Array of absolute paths to git repositories
   */
  async scanForRepos(adapter: ExecutionAdapter): Promise<string[]> {
    // Return cached results if still valid
    const now = Date.now();
    if (this.repoCache && now - this.cacheTimestamp < this.cacheExpiryMs) {
      return this.repoCache;
    }

    const executionId = 'scan-repos';

    // First check if projectsRoot itself is a git repository
    if (await this.isGitRepo(this.projectsRoot, adapter)) {
      // Single repo mode - projectsRoot is the repository
      this.repoCache = [this.projectsRoot];
      this.cacheTimestamp = now;
      return this.repoCache;
    }

    // Multi-repo mode - scan for child repositories
    const lsResult = await adapter.executeCommand(
      executionId,
      `find "${this.projectsRoot}" -maxdepth 1 -type d 2>/dev/null || true`,
    );

    if (lsResult.exitCode !== 0) {
      console.warn(`Failed to list directories in ${this.projectsRoot}: ${lsResult.stderr}`);
      return [];
    }

    const directories = lsResult.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line !== this.projectsRoot);

    // Check which directories are git repositories
    const repos: string[] = [];

    for (const dir of directories) {
      if (await this.isGitRepo(dir, adapter)) {
        repos.push(dir);
      }
    }

    // Sort for consistent ordering
    repos.sort();

    // Cache the results
    this.repoCache = repos;
    this.cacheTimestamp = now;

    return repos;
  }

  /**
   * Get the repository containing a specific file
   * @param filePath Absolute path to the file
   * @returns Repository path or null if file is not in any repo
   */
  getRepoForFile(filePath: string): string | null {
    if (!this.repoCache) {
      // Cannot determine without scanning first
      return null;
    }

    // Find the longest matching repo path (handles nested structures)
    let bestMatch: string | null = null;
    let bestMatchLength = 0;

    for (const repoPath of this.repoCache) {
      if (filePath.startsWith(repoPath + '/') || filePath === repoPath) {
        if (repoPath.length > bestMatchLength) {
          bestMatch = repoPath;
          bestMatchLength = repoPath.length;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Get all repository paths (cached if available)
   * @returns Array of repository paths from cache
   */
  getCachedRepos(): string[] {
    return this.repoCache || [];
  }

  /**
   * Clear the repository cache to force a rescan
   */
  clearCache(): void {
    this.repoCache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Get a user-friendly name for a repository based on its path
   * @param repoPath Absolute path to the repository
   * @returns Repository name (directory name)
   */
  getRepoName(repoPath: string): string {
    return path.basename(repoPath);
  }

  /**
   * Get directory structures for all repositories
   * @param adapter Execution adapter to generate directory maps
   * @returns Map of repository root paths to their directory structure strings
   */
  async getDirectoryStructures(adapter: ExecutionAdapter): Promise<Map<string, string>> {
    const repos = await this.scanForRepos(adapter);
    const directoryMap = new Map<string, string>();

    for (const repoPath of repos) {
      try {
        const directoryStructure = await adapter.generateDirectoryMap(repoPath);
        directoryMap.set(repoPath, directoryStructure);
      } catch (error) {
        console.warn(`Failed to generate directory structure for ${repoPath}:`, error);
        // Set empty structure as fallback
        directoryMap.set(
          repoPath,
          `<directory_structure repo="${this.getRepoName(repoPath)}">\nError generating directory structure\n</directory_structure>`,
        );
      }
    }

    return directoryMap;
  }

  /**
   * Check if a directory is a git repository
   * @param dirPath Absolute path to check
   * @param adapter Execution adapter to run commands
   * @returns True if directory contains a .git folder
   */
  private async isGitRepo(dirPath: string, adapter: ExecutionAdapter): Promise<boolean> {
    const executionId = 'check-git-repo';

    try {
      // Check if .git directory exists
      const gitCheckResult = await adapter.executeCommand(executionId, `test -d "${dirPath}/.git"`);
      return gitCheckResult.exitCode === 0;
    } catch (error: any) {
      // If the error is from a non-zero exit code, that means the test returned false
      if (error.result && error.result.exitCode === 1) {
        return false;
      }
      // For any other error (command not found, permission denied, etc.), re-throw
      throw error;
    }
  }
}
