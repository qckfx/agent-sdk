import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Container information type
 */
export interface ContainerInfo {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'not_found';
  projectPath: string;
  workspacePath: string;
}

/**
 * Options for the Docker container manager
 */
export interface DockerManagerOptions {
  /**
   * Absolute path to the *project root* that should be mounted into the
   * container as the workspace directory.  The caller (usually the
   * DockerExecutionAdapter factory) must provide this value – it is no longer
   * automatically detected.
   */
  projectRoot: string;

  composeFilePath?: string;
  serviceName?: string;
  projectName?: string;
  logger?: {
    debug: (message: string, category?: string) => void;
    info: (message: string, category?: string) => void;
    warn: (message: string, category?: string) => void;
    error: (message: string, error?: unknown, category?: string) => void;
  };
}

/**
 * Manages Docker containers using docker-compose
 */
export class DockerContainerManager {
  private composeFilePath: string;
  private serviceName: string;
  private projectName: string;
  private composeCmd: 'docker compose' | 'docker-compose' = 'docker-compose';
  private projectRoot: string;
  /**
   * Environment variables that must be passed to every docker‑compose command
   * so that the compose file can correctly mount the caller supplied project
   * directory.  At the moment we only inject HOST_PROJECT_ROOT but we keep
   * the structure extensible for future additions.
   */
  private composeEnv: Record<string, string>;
  private logger?: {
    debug: (message: string, category?: string) => void;
    info: (message: string, category?: string) => void;
    warn: (message: string, category?: string) => void;
    error: (message: string, error?: unknown, category?: string) => void;
  };

  /**
   * Create a Docker container manager using docker-compose
   */
  constructor(options: DockerManagerOptions) {

    // -------------------------------------------------------------------
    // 1)  Use the *project root* provided by the caller.  We no longer try to
    //     second‑guess the correct path in here – the surrounding application
    //     holds the necessary context and must pass the directory explicitly.
    // -------------------------------------------------------------------

    if (!options.projectRoot) {
      throw new Error('DockerContainerManager requires a "projectRoot" option');
    }

    // Resolve to an absolute path to avoid surprises later on and perform the
    // same normalisation that previously existed when we detected the path
    // ourselves:
    //   •  If the given path is somewhere inside node_modules we move up until
    //      we leave the folder – this keeps the original behaviour intact for
    //      test setups that run inside the package directory.
    let projectRoot = path.resolve(options.projectRoot);

    if (projectRoot.includes(`${path.sep}node_modules${path.sep}`)) {
      let candidate = projectRoot;
      while (candidate.includes(`${path.sep}node_modules${path.sep}`)) {
        candidate = path.dirname(candidate);
      }
      projectRoot = candidate;
    }

    this.projectRoot = projectRoot;

    // Build the environment map that will be supplied to every compose call.
    // We intentionally do NOT mutate process.env directly to avoid leaking
    // variables globally when the library is used as a dependency.
    this.composeEnv = {
      HOST_PROJECT_ROOT: this.projectRoot
    };

    // -------------------------------------------------------------------
    // 2)  Locate the docker‑compose.yml that ships with *this* package because
    //     the majority of user projects will not provide their own compose
    //     configuration.  The compose file lives under agent‑core/docker.
    // -------------------------------------------------------------------

    const packageCandidates: string[] = [
      // Development / ts‑node checkout
      path.resolve(__dirname, '..', '..'),
      // Installed bundle in node_modules (dist/cjs/…/utils)
      path.resolve(__dirname, '..', '..', '..', '..'),
    ];

    let composeFilePath = '';
    for (const root of packageCandidates) {
      const potential = path.join(root, 'docker', 'docker-compose.yml');
      if (fs.existsSync(potential)) {
        composeFilePath = potential;
        break;
      }
    }

    if (!composeFilePath) {
      throw new Error('Could not locate agent-core/docker/docker-compose.yml');
    }

    // If the caller provided a composeFilePath option we still let it
    // override our auto‑detected path – this keeps the previous public API
    // intact.
    this.composeFilePath = options.composeFilePath || composeFilePath;

    this.serviceName = options.serviceName || 'agent-sandbox';
    this.projectName = options.projectName || 'qckfx';
    this.logger = options.logger;

    // Detect whether the system uses `docker compose` (v2) or `docker-compose` (v1).
    // We run this detection lazily below in a best‑effort manner; if detection
    // fails we keep the default.
    this.detectComposeCommand().catch(() => {/* ignore, will fall back to default */});
  }

  /**
   * Check if Docker is available on this system
   */
  public async isDockerAvailable(): Promise<boolean> {
    try {
      const { stdout: dockerVersion } = await execAsync('docker --version');

      // Ensure compose command detection has finished
      await this.detectComposeCommand();

      const composeVersionCmd = this.composeCmd === 'docker-compose'
        ? 'docker-compose --version'
        : 'docker compose version';
      const { stdout: composeVersion } = await execAsync(composeVersionCmd);
      
      this.logger?.info(`Docker available: ${dockerVersion.trim()}`, 'system');
      this.logger?.info(`Docker Compose available: ${composeVersion.trim()}`, 'system');
      
      return true;
    } catch (error) {
      // Provide more detailed error messages based on error type
      if ((error as {code?: string}).code === 'ENOENT') {
        this.logger?.error('Docker not found on system PATH', 'system');
      } else if ((error as {code?: string}).code === 'EACCES') {
        this.logger?.error('Permission denied when checking Docker availability', 'system');
      } else {
        this.logger?.error(`Docker not available: ${(error as Error).message}`, 'system');
        if ((error as {stderr?: string}).stderr) {
          this.logger?.error(`Docker error details: ${(error as {stderr: string}).stderr}`, 'system');
        }
      }
      return false;
    }
  }

  // Cache container info to avoid repeated lookups
  private containerInfoCache: ContainerInfo | null = null;
  private containerInfoCacheTimestamp: number = 0;
  private readonly containerInfoCacheTTL: number = 30000; // 30 seconds TTL (increased from 5 seconds)

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Verify that the running container actually mounts the *expected* host
   * directory (this.projectRoot) to /workspace.  When the agent is re‑used
   * from another project without removing the old container we might end up
   * with a mismatch between the recorded project root and the bind mount that
   * is active inside the container.  In that situation we return _false_ so
   * that the caller can stop and recreate the sandbox.
   */
  private async isWorkspaceMountCorrect(containerId: string): Promise<boolean> {
    try {
      // Ask Docker for the mount information and parse the JSON output.
      const { stdout } = await execAsync(
        `docker inspect --format '{{ json .Mounts }}' ${containerId}`
      );

      type MountInfo = { Source: string; Destination: string };
      const mounts: MountInfo[] = JSON.parse(stdout.trim());

      const workspaceMount = mounts.find(m => m.Destination === '/workspace');
      if (!workspaceMount) {
        return false;
      }

      // Normalise both paths for a fair comparison.
      const expected = path.resolve(this.projectRoot);
      const actual   = path.resolve(workspaceMount.Source);

      return expected === actual;
    } catch {
      // Be conservative – if we cannot determine the mount we better assume
      // it's incorrect so that the caller replaces the container.
      return false;
    }
  }

  /**
   * Detect which compose command is available on the host and cache the result
   */
  private async detectComposeCommand(): Promise<void> {
    try {
      await execAsync('docker compose version');
      this.composeCmd = 'docker compose';
    } catch {
      // Fallback to classic docker‑compose. We don't re‑check here; a later
      // failure will simply propagate.
      this.composeCmd = 'docker-compose';
    }
    this.logger?.debug(`Using compose command: ${this.composeCmd}`, 'system');
  }

  /**
   * Get information about the container with caching to reduce Docker CLI calls
   */
  public async getContainerInfo(): Promise<ContainerInfo | null> {
    // Check if we have a valid cached result
    const now = Date.now();
    if (
      this.containerInfoCache &&
      now - this.containerInfoCacheTimestamp < this.containerInfoCacheTTL
    ) {
      return this.containerInfoCache;
    }
    
    try {
      // Get container ID using docker-compose
      const { stdout: idOutput } = await execAsync(
        `${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} ps -q ${this.serviceName}`,
        { env: { ...process.env, ...this.composeEnv } }
      );
      
      const containerId = idOutput.trim();
      if (!containerId) {
        // Update cache with null result
        this.containerInfoCache = null;
        this.containerInfoCacheTimestamp = now;
        return null;
      }
      
      // Check if container is running
      const { stdout: statusOutput } = await execAsync(`docker inspect -f '{{.State.Running}}' ${containerId}`);
      const isRunning = statusOutput.trim() === 'true';
      
      // Get container name
      const { stdout: nameOutput } = await execAsync(`docker inspect -f '{{.Name}}' ${containerId}`);
      const containerName = nameOutput.trim().replace(/^\//, '');
      
      // Use the project root that was detected in the constructor. This path
      // corresponds to the directory that is mounted into the container at
      // /workspace.
      const projectPath = this.projectRoot;
      
      // Create and cache the result
      const result: ContainerInfo = {
        id: containerId,
        name: containerName,
        status: isRunning ? 'running' : 'stopped',
        projectPath,
        workspacePath: '/workspace'
      };
      
      this.containerInfoCache = result;
      this.containerInfoCacheTimestamp = now;
      return result;
    } catch {
      // If there's an error, the container probably doesn't exist
      this.containerInfoCache = null;
      this.containerInfoCacheTimestamp = now;
      return null;
    }
  }

  /**
   * Start the container using docker-compose
   */
  public async startContainer(): Promise<ContainerInfo | null> {
    try {
      // Check if container already exists and is running
      const existingContainer = await this.getContainerInfo();
      if (existingContainer && existingContainer.status === 'running') {
        this.logger?.info(`Container ${existingContainer.name} is already running`, 'system');
        return existingContainer;
      }
      
      // Make sure docker directory exists
      const dockerDir = path.dirname(this.composeFilePath);
      if (!fs.existsSync(dockerDir)) {
        this.logger?.error(`Docker directory not found: ${dockerDir}`, 'system');
        return null;
      }
      
      // Make sure docker-compose file exists
      if (!fs.existsSync(this.composeFilePath)) {
        this.logger?.error(`Docker Compose file not found: ${this.composeFilePath}`, 'system');
        return null;
      }
      
      // Start container using docker-compose
      this.logger?.info(`Starting container using docker-compose: ${this.serviceName}`, 'system');
      await execAsync(
        `${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} up -d ${this.serviceName}`,
        { env: { ...process.env, ...this.composeEnv } }
      );
      
      // Get container info after starting
      const containerInfo = await this.getContainerInfo();
      if (!containerInfo) {
        this.logger?.error('Failed to get container info after starting', 'system');
        return null;
      }
      
      this.logger?.info(`Container started: ${containerInfo.name}`, 'system');
      return containerInfo;
    } catch (error) {
      this.logger?.error(`Error starting container: ${(error as Error).message}`, error, 'system');
      return null;
    }
  }

  /**
   * Stop the container using docker-compose
   */
  public async stopContainer(): Promise<boolean> {
    try {
      const containerInfo = await this.getContainerInfo();
      if (!containerInfo) {
        return false;
      }
      
      this.logger?.info(`Stopping container: ${containerInfo.name}`, 'system');
      await execAsync(
        `${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} stop ${this.serviceName}`,
        { env: { ...process.env, ...this.composeEnv } }
      );
      return true;
    } catch (error) {
      this.logger?.error(`Error stopping container: ${(error as Error).message}`, error, 'system');
      return false;
    }
  }

  /**
   * Stop and remove the container using docker-compose
   */
  public async removeContainer(): Promise<boolean> {
    try {
      const containerInfo = await this.getContainerInfo();
      if (!containerInfo) {
        return false;
      }
      
      this.logger?.info(`Removing container: ${containerInfo.name}`, 'system');
      await execAsync(
        `${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} down`,
        { env: { ...process.env, ...this.composeEnv } }
      );
      return true;
    } catch (error) {
      this.logger?.error(`Error removing container: ${(error as Error).message}`, error, 'system');
      return false;
    }
  }

  /**
   * Execute a command in the container
   */
  public async executeCommand(command: string, workingDir?: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    try {
      const containerInfo = await this.getContainerInfo();
      if (!containerInfo || containerInfo.status !== 'running') {
        throw new Error('Container is not running');
      }
      
      // Set working directory option if provided
      const workdirOption = workingDir ? `-w "${workingDir}"` : '';
      
      // Execute command in container
      //
      // NOTE: We explicitly raise the `maxBuffer` limit for `child_process.exec`.
      // The default (1 MiB) is not enough when we intentionally stream larger
      // blobs over stdout – for example when the checkpoint manager dumps a
      // git-bundle and subsequently pipes it through base64 inside the
      // container.  A moderately sized repository can easily exceed that
      // threshold which would make Node abort with
      //   "Error: stdout maxBuffer length exceeded".
      //
      // The upper bound of 100 MiB is an arbitrary but reasonable compromise
      // between accommodating sizeable archives and preventing unbounded
      // memory usage in the host process.  We keep the limit local to this
      // helper so other exec calls (e.g. in LocalExecutionAdapter) are not
      // affected unintentionally.
      const { stdout, stderr } = await execAsync(
        `docker exec ${workdirOption} ${containerInfo.id} bash -c "${command.replace(/"/g, '\\"')}"`,
        { maxBuffer: 100 * 1024 * 1024 }, // 100 MiB
      );
      
      return {
        stdout,
        stderr,
        exitCode: 0
      };
    } catch (error) {
      const err = error as Error & { code?: number; stderr?: string; stdout?: string };
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code || 1
      };
    }
  }

  /**
   * Check container health and ensure it's properly set up
   */
  public async ensureContainer(): Promise<ContainerInfo | null> {
    try {
      // Check if Docker is available
      const dockerAvailable = await this.isDockerAvailable();
      if (!dockerAvailable) {
        this.logger?.warn('Docker is not available on this system', 'system');
        return null;
      }
      
      // Start container if needed
      try {
        // Check if a container already exists
        const existingContainer = await this.getContainerInfo();
        if (existingContainer && existingContainer.status === 'running') {
          // Verify the workspace mount is correct
          const isMountCorrect = await this.isWorkspaceMountCorrect(existingContainer.id);
          
          if (!isMountCorrect) {
            this.logger?.warn('Container workspace mount is incorrect, recreating container', 'system');
            
            // Stop and remove the container with incorrect mount
            await this.removeContainer();
            
            // Create a new container
            return await this.startContainer();
          }
          
          // Container exists and mount is correct, return it
          return existingContainer;
        }
        
        // Start a new container
        const containerInfo = await this.startContainer();
        if (!containerInfo) {
          this.logger?.error('Failed to start Docker container', 'system');
          return null;
        }
        
        // Check if container is healthy with timeout
        let attempts = 0;
        const maxAttempts = 3;
        let containerReady = false;
        
        while (attempts < maxAttempts && !containerReady) {
          try {
            attempts++;
            const { exitCode } = await this.executeCommand('echo "Container health check"');
            if (exitCode === 0) {
              containerReady = true;
              break;
            }
            
            // Wait before retry (reduced from 1000ms for faster initialization)
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (healthError) {
            this.logger?.warn(`Health check attempt ${attempts} failed: ${(healthError as Error).message}`, 'system');
            
            if (attempts >= maxAttempts) {
              throw healthError;
            }
            
            // Wait before retry (reduced from 1000ms for faster initialization)
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        if (!containerReady) {
          this.logger?.error('Container health check failed after multiple attempts', 'system');
          return null;
        }
        
        return containerInfo;
      } catch (startError) {
        this.logger?.error(`Error starting container: ${(startError as Error).message}`, startError, 'system');
        return null;
      }
    } catch (error) {
      this.logger?.error(`Error ensuring container: ${(error as Error).message}`, error, 'system');
      return null;
    }
  }
}