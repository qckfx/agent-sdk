/**
 * Types and interfaces for repository information
 */

import { SessionState } from './model.js';

/**
 * Repository information for a session
 */
export interface RepositoryInfo {
  /**
   * Working directory path
   */
  workingDirectory: string;
  
  /**
   * Whether the directory is a git repository
   */
  isGitRepository: boolean;
  
  /**
   * Current branch name (if git repository)
   */
  currentBranch?: string;
  
  /**
   * Whether the repository has uncommitted changes
   */
  hasUncommittedChanges?: boolean;
  
  /**
   * Hash of the most recent commit (if git repository)
   */
  latestCommitHash?: string;
  
  /**
   * Warning flags for the repository state
   */
  warnings?: {
    /**
     * Whether there are uncommitted changes (which won't be included in the saved state)
     */
    uncommittedChanges?: boolean;
    
    /**
     * Whether there are untracked files (which won't be included in the saved state)
     */
    untrackedFiles?: boolean;
  };
}

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
}