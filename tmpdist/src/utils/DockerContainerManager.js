import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
// ---------------------------------------------------------------------------
// __dirname helper for ESM
// ---------------------------------------------------------------------------
// In CommonJS modules Node provides the global `__dirname`.  For ESM (the
// default in this repo – see "type":"module" in package.json) it is *not*
// defined.  Rather than scattering `typeof __dirname` checks we derive a local
// equivalent once and reference that throughout the file.
// Create a proper dirname value that works in both ESM and CJS
// For ESM, we'll use fileURLToPath to get the directory path from import.meta.url
// For CJS, we'll use the standard __dirname
let esmDirname;
// Check if we're in CommonJS (where __dirname is available)
if (typeof __dirname !== 'undefined') {
    esmDirname = __dirname;
}
// We're in ESM - this branch is only used in ESM builds
else {
    // This will never execute in CJS builds due to the conditional above
    // @ts-expect-error - import.meta is not available in CJS
    const moduleURL = import.meta.url;
    esmDirname = path.dirname(fileURLToPath(moduleURL));
}
const execAsync = promisify(exec);
/**
 * Manages Docker containers using docker-compose
 */
export class DockerContainerManager {
    /**
     * Create a Docker container manager using docker-compose
     */
    constructor(options) {
        // -------------------------------------------------------------------
        // 1)  Use the *project root* provided by the caller.  We no longer try to
        //     second‑guess the correct path in here – the surrounding application
        //     holds the necessary context and must pass the directory explicitly.
        // -------------------------------------------------------------------
        this.composeCmd = 'docker-compose';
        // Cache container info to avoid repeated lookups
        this.containerInfoCache = null;
        this.containerInfoCacheTimestamp = 0;
        this.containerInfoCacheTTL = 30000; // 30 seconds TTL (increased from 5 seconds)
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
        const packageCandidates = [
            // Development / ts‑node checkout
            path.resolve(esmDirname, '..', '..'),
            // Installed bundle in node_modules (dist/cjs/…/utils)
            path.resolve(esmDirname, '..', '..', '..', '..'),
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
        this.detectComposeCommand().catch(() => { });
    }
    /**
     * Check if Docker is available on this system
     */
    async isDockerAvailable() {
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
        }
        catch (error) {
            // Provide more detailed error messages based on error type
            if (error.code === 'ENOENT') {
                this.logger?.error('Docker not found on system PATH', 'system');
            }
            else if (error.code === 'EACCES') {
                this.logger?.error('Permission denied when checking Docker availability', 'system');
            }
            else {
                this.logger?.error(`Docker not available: ${error.message}`, 'system');
                if (error.stderr) {
                    this.logger?.error(`Docker error details: ${error.stderr}`, 'system');
                }
            }
            return false;
        }
    }
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
    async isWorkspaceMountCorrect(containerId) {
        try {
            // Ask Docker for the mount information and parse the JSON output.
            const { stdout } = await execAsync(`docker inspect --format '{{ json .Mounts }}' ${containerId}`);
            const mounts = JSON.parse(stdout.trim());
            const workspaceMount = mounts.find(m => m.Destination === '/workspace');
            if (!workspaceMount) {
                return false;
            }
            // Normalise both paths for a fair comparison.
            const expected = path.resolve(this.projectRoot);
            const actual = path.resolve(workspaceMount.Source);
            return expected === actual;
        }
        catch {
            // Be conservative – if we cannot determine the mount we better assume
            // it's incorrect so that the caller replaces the container.
            return false;
        }
    }
    /**
     * Detect which compose command is available on the host and cache the result
     */
    async detectComposeCommand() {
        try {
            await execAsync('docker compose version');
            this.composeCmd = 'docker compose';
        }
        catch {
            // Fallback to classic docker‑compose. We don't re‑check here; a later
            // failure will simply propagate.
            this.composeCmd = 'docker-compose';
        }
        this.logger?.debug(`Using compose command: ${this.composeCmd}`, 'system');
    }
    /**
     * Get information about the container with caching to reduce Docker CLI calls
     */
    async getContainerInfo() {
        // Check if we have a valid cached result
        const now = Date.now();
        if (this.containerInfoCache &&
            now - this.containerInfoCacheTimestamp < this.containerInfoCacheTTL) {
            return this.containerInfoCache;
        }
        try {
            // Get container ID using docker-compose
            const { stdout: idOutput } = await execAsync(`${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} ps -q ${this.serviceName}`, { env: { ...process.env, ...this.composeEnv } });
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
            const result = {
                id: containerId,
                name: containerName,
                status: isRunning ? 'running' : 'stopped',
                projectPath,
                workspacePath: '/workspace'
            };
            this.containerInfoCache = result;
            this.containerInfoCacheTimestamp = now;
            return result;
        }
        catch {
            // If there's an error, the container probably doesn't exist
            this.containerInfoCache = null;
            this.containerInfoCacheTimestamp = now;
            return null;
        }
    }
    /**
     * Start the container using docker-compose
     */
    async startContainer() {
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
            await execAsync(`${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} up -d ${this.serviceName}`, { env: { ...process.env, ...this.composeEnv } });
            // Get container info after starting
            const containerInfo = await this.getContainerInfo();
            if (!containerInfo) {
                this.logger?.error('Failed to get container info after starting', 'system');
                return null;
            }
            this.logger?.info(`Container started: ${containerInfo.name}`, 'system');
            return containerInfo;
        }
        catch (error) {
            this.logger?.error(`Error starting container: ${error.message}`, error, 'system');
            return null;
        }
    }
    /**
     * Stop the container using docker-compose
     */
    async stopContainer() {
        try {
            const containerInfo = await this.getContainerInfo();
            if (!containerInfo) {
                return false;
            }
            this.logger?.info(`Stopping container: ${containerInfo.name}`, 'system');
            await execAsync(`${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} stop ${this.serviceName}`, { env: { ...process.env, ...this.composeEnv } });
            return true;
        }
        catch (error) {
            this.logger?.error(`Error stopping container: ${error.message}`, error, 'system');
            return false;
        }
    }
    /**
     * Stop and remove the container using docker-compose
     */
    async removeContainer() {
        try {
            const containerInfo = await this.getContainerInfo();
            if (!containerInfo) {
                return false;
            }
            this.logger?.info(`Removing container: ${containerInfo.name}`, 'system');
            await execAsync(`${this.composeCmd} -f "${this.composeFilePath}" -p ${this.projectName} down`, { env: { ...process.env, ...this.composeEnv } });
            return true;
        }
        catch (error) {
            this.logger?.error(`Error removing container: ${error.message}`, error, 'system');
            return false;
        }
    }
    /**
     * Execute a command in the container
     */
    async executeCommand(command, workingDir) {
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
            const { stdout, stderr } = await execAsync(`docker exec ${workdirOption} ${containerInfo.id} bash -c "${command.replace(/"/g, '\\"')}"`, { maxBuffer: 100 * 1024 * 1024 });
            return {
                stdout,
                stderr,
                exitCode: 0
            };
        }
        catch (error) {
            const err = error;
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
    async ensureContainer() {
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
                    }
                    catch (healthError) {
                        this.logger?.warn(`Health check attempt ${attempts} failed: ${healthError.message}`, 'system');
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
            }
            catch (startError) {
                this.logger?.error(`Error starting container: ${startError.message}`, startError, 'system');
                return null;
            }
        }
        catch (error) {
            this.logger?.error(`Error ensuring container: ${error.message}`, error, 'system');
            return null;
        }
    }
}
//# sourceMappingURL=DockerContainerManager.js.map