import { ExecutionAdapter } from '../types/tool.js';
import { LocalExecutionAdapter } from './LocalExecutionAdapter.js';
import { DockerExecutionAdapter } from './DockerExecutionAdapter.js';
import { DockerContainerManager } from './DockerContainerManager.js';
import { E2BExecutionAdapter } from './E2BExecutionAdapter.js';
import { LogCategory } from './logger.js';

export type ExecutionAdapterType = 'local' | 'docker' | 'e2b';

export interface ExecutionAdapterFactoryOptions {
  /**
   * Preferred execution adapter type
   */
  type?: ExecutionAdapterType;
  
  /**
   * Whether to auto-fallback to local execution if preferred type fails
   */
  autoFallback?: boolean;
  
  /**
   * Docker-specific options
   */
  docker?: {
    /**
     * Absolute path of the project root that will be mounted into the Docker
     * sandbox.  Must be provided when the adapter type is set to "docker".
     */
    projectRoot: string;
    composeFilePath?: string;
    serviceName?: string;
    projectName?: string;
  };
  
  /**
   * E2B-specific options
   */
  e2b?: {
    sandboxId?: string;
  };
  
  /**
   * Logger for execution adapter
   */
  logger?: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
}

/**
 * Factory function to create the appropriate execution adapter
 */
export async function createExecutionAdapter(
  options: ExecutionAdapterFactoryOptions = {}
): Promise<{
  adapter: ExecutionAdapter;
  type: ExecutionAdapterType;
}> {
  const { 
    type = 'docker',
    autoFallback = true,
    logger
  } = options;
  
  logger?.info(`Creating execution adapter: Requested type = ${type}, default = docker`, 'system');
  
  // Track reasons for fallback for logging
  let fallbackReason = '';
  
  // Try to create the requested adapter type
  try {
    if (type === 'docker') {
      logger?.info('Attempting to create Docker execution adapter', LogCategory.SYSTEM);
      
      // Create the container manager (caller must provide projectRoot)
      if (!options.docker?.projectRoot) {
        throw new Error('projectRoot must be provided when creating a Docker execution adapter');
      }

      const containerManager = new DockerContainerManager({
        projectRoot: options.docker.projectRoot,
        composeFilePath: options.docker.composeFilePath,
        serviceName: options.docker.serviceName,
        projectName: options.docker.projectName,
        logger
      });
      
      // Check if Docker is available
      const dockerAvailable = await containerManager.isDockerAvailable();
      if (!dockerAvailable) {
        fallbackReason = 'Docker is not available on this system';
        throw new Error(fallbackReason);
      }
      
      // Ensure container is running
      const containerInfo = await containerManager.ensureContainer();
      if (!containerInfo) {
        fallbackReason = 'Failed to start Docker container';
        throw new Error(fallbackReason);
      }
      
      // Create Docker execution adapter
      const dockerAdapter = new DockerExecutionAdapter(containerManager, { logger });
      
      // Verify Docker adapter is working by running a simple test command
      try {
        const { exitCode } = await dockerAdapter.executeCommand('echo "Docker test"');
        if (exitCode !== 0) {
          fallbackReason = 'Docker container is not responding to commands';
          throw new Error(fallbackReason);
        }
      } catch (cmdError) {
        fallbackReason = `Docker command execution failed: ${(cmdError as Error).message}`;
        throw cmdError;
      }
      
      logger?.info('Successfully created Docker execution adapter', LogCategory.SYSTEM);
      
      // Environment status events are now emitted by the DockerExecutionAdapter itself
      
      return {
        adapter: dockerAdapter,
        type: 'docker'
      };
    }
    
    if (type === 'e2b') {
      logger?.info('Creating E2B execution adapter', LogCategory.SYSTEM);
      
      if (!options.e2b?.sandboxId) {
        fallbackReason = 'E2B sandbox ID is required';
        throw new Error(fallbackReason);
      }
      
      const e2bAdapter = await E2BExecutionAdapter.create(options.e2b.sandboxId, { logger });
      
      return {
        adapter: e2bAdapter,
        type: 'e2b'
      };
    }
  } catch (error) {
    // Add detailed error logging
    logger?.error(
      `Failed to create ${type} execution adapter: ${(error as Error).message}`, 
      error, 
      LogCategory.SYSTEM
    );
    
    // If auto fallback is disabled, rethrow the error
    if (!autoFallback) {
      throw error;
    }
    
    // Log warning about fallback
    logger?.warn(
      `Falling back to local execution: ${fallbackReason || (error as Error).message}`, 
      LogCategory.SYSTEM
    );
  }
  
  // Fall back to local execution
  logger?.info('Creating local execution adapter', LogCategory.SYSTEM);
  
  return {
    adapter: new LocalExecutionAdapter({ logger }),
    type: 'local'
  };
}