/**
 * Sandbox pool for managing multiple E2B sandboxes
 * 
 * Uses the functions from sandbox.ts to properly initialize, reset, and clean up sandboxes
 * with the repository and dependencies already set up.
 */

import { Sandbox } from 'e2b';
import { createLogger, LogLevel, Logger } from '../../utils/logger.js';
import { E2BExecutionAdapter } from '../../utils/E2BExecutionAdapter.js';
import { initializeSandbox, resetSandbox, cleanupSandbox } from './sandbox.js';

// Create a logger for the sandbox pool
const logger: Logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'SandboxPool'
});


/**
 * Creates a new E2B sandbox instance fully initialized with the repository
 * 
 * @returns A configured sandbox instance and execution adapter
 */
export async function createSandbox(): Promise<{ sandbox: Sandbox; sandboxId: string; executionAdapter: E2BExecutionAdapter }> {
  try {
    logger.info('Creating new sandbox instance with repository initialization');
    
    // Use the initializeSandbox function from sandbox.ts
    // This handles checking out the repo, installing dependencies, etc.
    const { sandboxId, executionAdapter } = await initializeSandbox(logger);
    
    // Connect to the sandbox to get the Sandbox instance
    const sandbox = await Sandbox.connect(sandboxId);
    
    logger.info(`Created and initialized sandbox with ID: ${sandboxId}`);
    return { sandbox, sandboxId, executionAdapter };
  } catch (error) {
    logger.error('Failed to create sandbox', error);
    throw error;
  }
}

/**
 * Class for managing a pool of E2B sandboxes for parallel execution
 */
export class SandboxPool {
  // Store full sandbox info including execution adapters
  private availableSandboxes: { 
    sandbox: Sandbox; 
    sandboxId: string; 
    executionAdapter: E2BExecutionAdapter;
  }[] = [];
  
  private busySandboxes: Map<string, { 
    sandbox: Sandbox; 
    sandboxId: string; 
    executionAdapter: E2BExecutionAdapter;
  }> = new Map();
  
  private initializationPromise: Promise<void> | null = null;
  private isShuttingDown = false;

  /**
   * Creates a new SandboxPool with the specified number of sandboxes
   * 
   * @param size Number of sandboxes to create in the pool
   */
  constructor(private size: number) {
    this.initializationPromise = this.initialize();
  }

  /**
   * Initialize the sandbox pool by creating the specified number of sandboxes
   */
  private async initialize(): Promise<void> {
    try {
      logger.info(`Initializing sandbox pool with ${this.size} sandboxes`);
      
      // Create all sandboxes in parallel
      const sandboxPromises = Array(this.size)
        .fill(0)
        .map(() => this.createAndAddSandbox());
      
      await Promise.all(sandboxPromises);
      
      logger.info(`Sandbox pool initialized with ${this.availableSandboxes.length} sandboxes`);
    } catch (error) {
      logger.error('Failed to initialize sandbox pool', error);
      throw error;
    }
  }

  /**
   * Create a single sandbox and add it to the available pool
   */
  private async createAndAddSandbox(): Promise<void> {
    try {
      // Use the enhanced createSandbox that initializes the repository
      const sandboxInfo = await createSandbox();
      this.availableSandboxes.push(sandboxInfo);
    } catch (error) {
      logger.error('Failed to create sandbox for pool', error);
      throw error;
    }
  }

  /**
   * Wait for the pool to finish initializing
   */
  async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Acquire a sandbox from the pool.
   * If no sandboxes are available, this will wait until one becomes available.
   * 
   * @param timeoutMs Optional timeout in milliseconds
   * @returns A sandbox info object or null if timeout is reached
   */
  async acquireSandbox(timeoutMs?: number): Promise<{
    sandbox: Sandbox;
    sandboxId: string;
    executionAdapter: E2BExecutionAdapter;
  } | null> {
    // Wait for initialization to complete first
    await this.waitForInitialization();
    
    if (this.isShuttingDown) {
      throw new Error('Cannot acquire sandbox: pool is shutting down');
    }

    // If we have an available sandbox, return it immediately
    if (this.availableSandboxes.length > 0) {
      const sandboxInfo = this.availableSandboxes.shift()!;
      this.busySandboxes.set(sandboxInfo.sandboxId, sandboxInfo);
      return sandboxInfo;
    }

    // If we don't have an available sandbox, we need to wait
    return new Promise((resolve, reject) => {
      // Set up timeout if specified
      const timeoutId = timeoutMs 
        ? setTimeout(() => {
            resolve(null);
          }, timeoutMs)
        : null;
      
      // Check for available sandbox every 100ms
      const interval = setInterval(() => {
        if (this.isShuttingDown) {
          clearInterval(interval);
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error('Cannot acquire sandbox: pool is shutting down'));
          return;
        }

        if (this.availableSandboxes.length > 0) {
          clearInterval(interval);
          if (timeoutId) clearTimeout(timeoutId);
          
          const sandboxInfo = this.availableSandboxes.shift()!;
          this.busySandboxes.set(sandboxInfo.sandboxId, sandboxInfo);
          resolve(sandboxInfo);
        }
      }, 100);
    });
  }

  /**
   * Release a sandbox back to the pool
   * 
   * @param sandboxId The ID of the sandbox to release
   * @param resetBeforeRelease Whether to reset the sandbox before releasing it back to the pool
   */
  async releaseSandbox(sandboxId: string, resetBeforeRelease: boolean = true): Promise<void> {
    if (this.busySandboxes.has(sandboxId)) {
      const sandboxInfo = this.busySandboxes.get(sandboxId)!;
      this.busySandboxes.delete(sandboxId);
      
      // If requested, reset the sandbox to its original state
      if (resetBeforeRelease) {
        try {
          // Reset the sandbox using the imported function
          
          // Reset the sandbox to the baseline state
          logger.info(`Resetting sandbox ${sandboxId} before releasing back to pool`);
          const newExecutionAdapter = await resetSandbox(sandboxId, logger);
          
          // Update with the new execution adapter
          sandboxInfo.executionAdapter = newExecutionAdapter;
        } catch (error) {
          logger.error(`Failed to reset sandbox ${sandboxId}`, error);
        }
      }
      
      this.availableSandboxes.push(sandboxInfo);
    }
  }

  /**
   * Get the number of available sandboxes
   */
  get availableCount(): number {
    return this.availableSandboxes.length;
  }

  /**
   * Get the number of busy sandboxes
   */
  get busyCount(): number {
    return this.busySandboxes.size;
  }

  /**
   * Get the total number of sandboxes in the pool
   */
  get totalCount(): number {
    return this.availableSandboxes.length + this.busySandboxes.size;
  }

  /**
   * Shutdown the sandbox pool, closing all sandboxes
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    // First wait for initialization to complete if it's still in progress
    await this.waitForInitialization();
    
    logger.info('Shutting down sandbox pool');
    
    // Clean up all sandboxes using the imported function
    
    // Close all available sandboxes
    const availableClosingPromises = this.availableSandboxes.map(async sandboxInfo => {
      try {
        // Use the cleanupSandbox function from sandbox.ts
        await cleanupSandbox(sandboxInfo.sandboxId, logger);
      } catch (error) {
        logger.error(`Error closing available sandbox ${sandboxInfo.sandboxId}`, error);
      }
    });
    
    // Close all busy sandboxes
    const busyClosingPromises = Array.from(this.busySandboxes.values()).map(async sandboxInfo => {
      try {
        // Use the cleanupSandbox function from sandbox.ts
        await cleanupSandbox(sandboxInfo.sandboxId, logger);
      } catch (error) {
        logger.error(`Error closing busy sandbox ${sandboxInfo.sandboxId}`, error);
      }
    });
    
    // Wait for all sandboxes to close
    await Promise.all([...availableClosingPromises, ...busyClosingPromises]);
    
    // Clear the pool
    this.availableSandboxes = [];
    this.busySandboxes.clear();
    
    logger.info('Sandbox pool shutdown complete');
  }

  /**
   * Execute a function with a sandbox, then release the sandbox back to the pool
   * 
   * @param fn Function to execute with the sandbox and its info
   * @param resetAfterUse Whether to reset the sandbox after use
   * @param timeoutMs Optional timeout for acquiring a sandbox
   * @returns The result of the function execution
   */
  async withSandbox<T>(
    fn: (sandboxInfo: {
      sandbox: Sandbox;
      sandboxId: string;
      executionAdapter: E2BExecutionAdapter;
    }) => Promise<T>,
    resetAfterUse: boolean = true,
    timeoutMs?: number
  ): Promise<T> {
    const sandboxInfo = await this.acquireSandbox(timeoutMs);
    
    if (!sandboxInfo) {
      throw new Error('Failed to acquire sandbox: timeout reached');
    }
    
    try {
      return await fn(sandboxInfo);
    } finally {
      await this.releaseSandbox(sandboxInfo.sandboxId, resetAfterUse);
    }
  }

  /**
   * Helper method to run a function with just an execution adapter
   * 
   * @param fn Function to execute with the execution adapter
   * @param resetAfterUse Whether to reset the sandbox after use
   * @param timeoutMs Optional timeout for acquiring a sandbox
   * @returns The result of the function execution
   */
  async withExecutionAdapter<T>(
    fn: (adapter: E2BExecutionAdapter) => Promise<T>,
    resetAfterUse: boolean = true,
    timeoutMs?: number
  ): Promise<T> {
    return this.withSandbox(async (sandboxInfo) => {
      return await fn(sandboxInfo.executionAdapter);
    }, resetAfterUse, timeoutMs);
  }
  
  /**
   * Helper method to run multiple sequential operations on the same sandbox without resetting between them
   * This is useful for agent execution followed by judging, where we want to preserve the state
   * 
   * @param fn Function to execute with the sandbox info that returns another function for judging
   * @param timeoutMs Optional timeout for acquiring a sandbox
   * @returns The result of both function executions
   */
  async withConsecutiveOperations<T>(
    fn: (sandboxInfo: {
      sandbox: Sandbox;
      sandboxId: string;
      executionAdapter: E2BExecutionAdapter;
    }) => Promise<(sameInfo: {
      sandbox: Sandbox;
      sandboxId: string;
      executionAdapter: E2BExecutionAdapter;
    }) => Promise<T>>,
    timeoutMs?: number
  ): Promise<T> {
    const sandboxInfo = await this.acquireSandbox(timeoutMs);
    
    if (!sandboxInfo) {
      throw new Error('Failed to acquire sandbox: timeout reached');
    }
    
    try {
      // Run the first function and get the second function
      const secondOperation = await fn(sandboxInfo);
      
      // Run the second function on the same sandbox without resetting
      return await secondOperation(sandboxInfo);
    } finally {
      // Always reset after the complete sequence
      await this.releaseSandbox(sandboxInfo.sandboxId, true);
    }
  }
}