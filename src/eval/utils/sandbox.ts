/**
 * E2B Sandbox initialization and management for evaluation
 */

import { Sandbox } from 'e2b';
import * as dotenv from 'dotenv';
import path from 'path';
import { Logger, LogCategory, createLogger, LogLevel } from '../../utils/logger.js';
import { E2BExecutionAdapter } from '../../utils/E2BExecutionAdapter.js';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Also try to load from the root .env as fallback
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

/**
 * Initialize an E2B sandbox for secure evaluation
 *
 * @param logger Logger instance to use for messages
 * @returns The sandbox ID and execution adapter
 * @throws Error if E2B_API_KEY is missing or initialization fails
 */
export async function initializeSandbox(logger?: Logger): Promise<{
  sandboxId: string;
  executionAdapter: E2BExecutionAdapter;
}> {
  // Create a default logger if none is provided
  const log = logger || createLogger({ level: LogLevel.INFO });

  log.info('Initializing E2B sandbox for evaluation', LogCategory.SYSTEM);

  try {
    // Validate E2B API key is present
    if (!process.env.E2B_API_KEY) {
      throw new Error('E2B_API_KEY is required for running evaluations in a sandbox');
    }

    // Create the sandbox using the default template with a longer timeout
    const sandbox = await Sandbox.create('base', { timeoutMs: 900000 });
    const sandboxId = sandbox.sandboxId;

    // Define command options with longer timeout
    const cmdOpts = { timeoutMs: 900000 };

    // Verify sandbox is ready
    const result = await sandbox.commands.run('echo "Sandbox initialized"', cmdOpts);
    if (!result.stdout.includes('Sandbox initialized')) {
      throw new Error('Failed to initialize sandbox');
    }

    // Clone the repository into the sandbox
    log.info('Cloning repository into sandbox...', LogCategory.SYSTEM);

    // Check if git is already installed
    const gitCheck = await sandbox.commands.run('which git || echo "not found"', cmdOpts);

    if (gitCheck.stdout.includes('not found')) {
      log.info('Git not found, installing...', LogCategory.SYSTEM);
      // Use sudo for apt operations to avoid permission issues
      await sandbox.commands.run('sudo apt-get update', cmdOpts);
      await sandbox.commands.run('sudo apt-get install -y git', cmdOpts);
    }

    // Clone to a directory where we have permissions
    const appDir = '/home/user/app';
    await sandbox.commands.run(`mkdir -p ${appDir}`, cmdOpts);

    // Now clone the repository with a specific commit hash for consistency
    const cloneResult = await sandbox.commands.run(
      `git clone https://github.com/EarlywormTeam/qckfx.git ${appDir}`,
      cmdOpts,
    );
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
    }

    // Checkout a specific commit to ensure consistency
    const checkoutResult = await sandbox.commands.run(
      `cd ${appDir} && git checkout 29e5c28`,
      cmdOpts,
    );
    if (checkoutResult.exitCode !== 0) {
      throw new Error(`Failed to checkout commit: ${checkoutResult.stderr}`);
    }

    // Set up the working directory for the sandbox
    await sandbox.commands.run(`cd ${appDir}`, cmdOpts);

    // Install Node.js 22.x
    log.info('Installing Node.js 22.x...', LogCategory.SYSTEM);

    // Download and run the NodeSource setup script for Node.js 22.x
    await sandbox.commands.run(
      'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -',
      cmdOpts,
    );
    await sandbox.commands.run('sudo apt-get install -y nodejs', cmdOpts);

    // Verify Node.js version
    const nodeVersion = await sandbox.commands.run('node --version', cmdOpts);
    log.info(`Installed Node.js version: ${nodeVersion.stdout.trim()}`, LogCategory.SYSTEM);

    // Install project dependencies
    log.info('Installing project dependencies...', LogCategory.SYSTEM);

    // Create a .npmrc file to avoid permission issues
    await sandbox.commands.run(`echo "unsafe-perm=true" > ${appDir}/.npmrc`, cmdOpts);

    // Install dependencies - using --ignore-scripts to avoid running scripts that might fail
    // We don't need a working build, just the source files and type definitions
    await sandbox.commands.run(`cd ${appDir} && npm install --ignore-scripts --quiet`, cmdOpts);

    // Ensure our tools use the correct directory as root
    process.env.SANDBOX_ROOT = appDir;

    // Create the execution adapter for the sandbox
    const executionAdapter = await E2BExecutionAdapter.create(sandboxId, { logger: log });

    log.info('E2B sandbox initialized successfully', LogCategory.SYSTEM);
    return { sandboxId, executionAdapter };
  } catch (error) {
    log.error('Failed to initialize E2B sandbox', error, LogCategory.SYSTEM);
    throw error;
  }
}

/**
 * Clean up a sandbox environment
 *
 * @param sandboxId The sandbox ID to clean up
 * @param logger Optional logger instance
 * @throws Error if cleanup fails
 */
export async function resetSandbox(
  sandboxId: string,
  logger?: Logger,
): Promise<E2BExecutionAdapter> {
  const log = logger || createLogger({ level: LogLevel.INFO });

  if (!sandboxId) {
    log.warn('No sandbox ID provided, nothing to reset', LogCategory.SYSTEM);
    throw new Error('No sandbox ID provided for reset');
  }

  try {
    log.info(`Resetting sandbox with ID: ${sandboxId}`, LogCategory.SYSTEM);

    // Connect to the sandbox
    const sandbox = await Sandbox.connect(sandboxId);

    // Define app directory
    const appDir = '/home/user/app';

    // Fast reset by just using git to restore the original state
    // This is much faster than reinstalling everything
    log.info('Fast resetting repository state...', LogCategory.SYSTEM);

    // Set longer timeout for git operations
    const options = { timeoutMs: 900000 };

    // Hard reset and clean working directory
    const resetResult = await sandbox.commands.run(
      `cd ${appDir} && git reset --hard 29e5c28 && git clean -fdx`,
      options,
    );
    if (resetResult.exitCode !== 0) {
      throw new Error(`Failed to reset repository: ${resetResult.stderr}`);
    }

    // Refresh sandbox timeout
    await sandbox.setTimeout(900000); // 15 minutes timeout for sandbox operations

    // Reset the environment variable for SANDBOX_ROOT
    process.env.SANDBOX_ROOT = appDir;

    // Create a new execution adapter for the sandbox
    const executionAdapter = await E2BExecutionAdapter.create(sandboxId, { logger: log });

    log.info('Sandbox reset successfully', LogCategory.SYSTEM);
    return executionAdapter;
  } catch (error) {
    log.error('Error resetting sandbox', error, LogCategory.SYSTEM);
    throw error;
  }
}

export async function cleanupSandbox(sandboxId: string, logger?: Logger): Promise<void> {
  const log = logger || createLogger({ level: LogLevel.INFO });

  if (!sandboxId) {
    log.warn('No sandbox ID provided, nothing to clean up', LogCategory.SYSTEM);
    return;
  }

  try {
    log.info(`Attempting to kill sandbox with ID: ${sandboxId}`, LogCategory.SYSTEM);
    // Use the kill method from the Sandbox class
    await Sandbox.kill(sandboxId);
    log.info('Sandbox cleaned up successfully', LogCategory.SYSTEM);
  } catch (error) {
    log.error('Error cleaning up sandbox', error, LogCategory.SYSTEM);
    throw error;
  }
}
