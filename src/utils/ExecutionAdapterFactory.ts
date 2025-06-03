import { ExecutionAdapter } from '../types/tool.js';
import { LocalExecutionAdapter } from './LocalExecutionAdapter.js';
import { DockerExecutionAdapter } from './DockerExecutionAdapter.js';
import { DockerContainerManager } from './DockerContainerManager.js';
import { RemoteExecutionAdapter } from './RemoteExecutionAdapter.js';
import { CheckpointingExecutionAdapter } from './CheckpointingExecutionAdapter.js';
import { LogCategory, Logger } from './logger.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import { BusEvents } from '../types/bus-events.js';

export type ExecutionAdapterType = 'local' | 'docker' | 'remote';

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
   * Remote execution options
   */
  remote?: {
    sandboxId?: string;
    projectsRoot?: string;
  };

  /**
   * Root directory containing projects/repositories
   * For E2B: typically '/home/user/projects'
   * For local/docker: typically process.cwd()
   */
  projectsRoot?: string;

  /**
   * Logger for execution adapter
   */
  logger?: Logger;

  /**
   * Session ID (for checkpointing)
   */
  sessionId: string;

  /**
   * The per-agent event bus for lifecycle events.
   */
  eventBus: TypedEventEmitter<BusEvents>;
}

/**
 * Factory function to create the appropriate execution adapter
 */
export async function createExecutionAdapter(options: ExecutionAdapterFactoryOptions): Promise<{
  adapter: ExecutionAdapter;
  type: ExecutionAdapterType;
}> {
  const { type = 'docker', autoFallback = true, logger } = options;

  logger?.info(
    `Creating execution adapter: Requested type = ${type}, default = docker`,
    LogCategory.SYSTEM,
  );
  logger?.debug('Options:', LogCategory.SYSTEM, JSON.stringify(options, null, 2));

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
        logger,
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
      const dockerAdapter = new DockerExecutionAdapter(options.sessionId, containerManager, {
        logger,
        eventBus: options.eventBus,
      });

      // Verify Docker adapter is working by running a simple test command
      try {
        const { exitCode } = await dockerAdapter.executeCommand(
          'docker-test',
          'echo "Docker test"',
        );
        if (exitCode !== 0) {
          fallbackReason = 'Docker container is not responding to commands';
          throw new Error(fallbackReason);
        }
      } catch (cmdError) {
        fallbackReason = `Docker command execution failed: ${(cmdError as Error).message}`;
        throw cmdError;
      }

      logger?.info('Successfully created Docker execution adapter', LogCategory.SYSTEM);

      // Create concrete adapter
      let concreteAdapter: ExecutionAdapter = dockerAdapter;

      const res = await dockerAdapter.executeCommand('get-pwd', 'pwd');
      const pwd = res.stdout.trim();

      let attempts = 0;
      while (!dockerAdapter.initialized && attempts < 10) {
        logger?.debug(
          'Waiting for Docker container to initialize...',
          LogCategory.SYSTEM,
          attempts,
        );
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!dockerAdapter.initialized) {
        throw new Error('Docker container failed to initialize');
      }

      // Wrap with checkpointing
      concreteAdapter = new CheckpointingExecutionAdapter(dockerAdapter, options.sessionId);
      logger?.info('Wrapped Docker adapter with checkpointing', LogCategory.SYSTEM);

      return {
        adapter: concreteAdapter,
        type: 'docker',
      };
    }
    if (type === 'remote') {
      logger?.info('Creating E2B execution adapter', LogCategory.SYSTEM);

      if (!options.remote?.sandboxId) {
        fallbackReason = 'E2B sandbox ID is required';
        throw new Error(fallbackReason);
      }

      const projectsRoot =
        options.remote.projectsRoot || options.projectsRoot || '/home/user/projects';
      const e2bAdapter = await RemoteExecutionAdapter.create(
        options.remote.sandboxId,
        options.sessionId,
        {
          logger,
          projectsRoot,
          eventBus: options.eventBus,
        },
      );

      // Create concrete adapter
      let concreteAdapter: ExecutionAdapter = e2bAdapter;

      const res = await e2bAdapter.executeCommand('get-pwd', 'pwd');
      const pwd = res.stdout.trim();

      concreteAdapter = new CheckpointingExecutionAdapter(e2bAdapter, options.sessionId);
      logger?.info('Wrapped E2B adapter with checkpointing', LogCategory.SYSTEM);

      return {
        adapter: concreteAdapter,
        type: 'remote',
      };
    }
  } catch (error) {
    // Add detailed error logging
    logger?.error(
      `Failed to create ${type} execution adapter: ${(error as Error).message}`,
      error,
      LogCategory.SYSTEM,
    );

    // If auto fallback is disabled, rethrow the error
    if (!autoFallback) {
      throw error;
    }

    // Log warning about fallback
    logger?.warn(
      `Falling back to local execution: ${fallbackReason || (error as Error).message}`,
      LogCategory.SYSTEM,
    );
  }

  // Fall back to local execution
  logger?.info('Creating local execution adapter', LogCategory.SYSTEM);

  // Create concrete adapter
  const localAdapter = new LocalExecutionAdapter(options.sessionId, {
    logger,
    eventBus: options.eventBus,
  });
  let concreteAdapter: ExecutionAdapter = localAdapter;

  const res = await localAdapter.executeCommand('get-pwd', 'pwd');
  const pwd = res.stdout.trim();

  // Wrap with checkpointing
  concreteAdapter = new CheckpointingExecutionAdapter(localAdapter, options.sessionId);
  logger?.info('Wrapped local adapter with checkpointing', LogCategory.SYSTEM);

  return {
    adapter: concreteAdapter,
    type: 'local',
  };
}
