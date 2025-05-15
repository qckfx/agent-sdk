/**
 * Types and interfaces for repository information
 */

/**
 * Clean repository status - no uncommitted changes
 */
export interface CleanRepositoryStatus {
  type: 'clean';
}

/**
 * Dirty repository status - has uncommitted changes
 */
export interface DirtyRepositoryStatus {
  type: 'dirty';
  
  /**
   * Modified files not yet staged
   */
  modifiedFiles: string[];
  
  /**
   * Files staged for commit
   */
  stagedFiles: string[];
  
  /**
   * Untracked files
   */
  untrackedFiles: string[];
  
  /**
   * Deleted files
   */
  deletedFiles: string[];
}

/**
 * Repository status - either clean or dirty with details
 */
export type RepositoryStatus = CleanRepositoryStatus | DirtyRepositoryStatus;

/**
 * Git repository information to be used in the system prompt
 */
export interface GitRepositoryInfo {
  /**
   * Whether the directory is a git repository
   */
  isGitRepository: boolean;
  
  /**
   * Current branch name
   */
  currentBranch: string;
  
  /**
   * Default branch name (typically 'main' or 'master')
   */
  defaultBranch: string;
  
  /**
   * Repository status details
   */
  status: RepositoryStatus;
  
  /**
   * Recent commits (hash and message)
   */
  recentCommits: string[];
  
  /**
   * Current commit SHA
   */
  commitSha?: string;
}