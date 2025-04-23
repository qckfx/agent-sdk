import path from 'path';
import { ExecutionAdapter } from '../types/tool.js';
import { FileEditToolErrorResult, FileEditToolSuccessResult } from '../tools/FileEditTool.js';
import { FileReadToolErrorResult, FileReadToolSuccessResult } from '../tools/FileReadTool.js';
import { FileEntry, LSToolErrorResult, LSToolSuccessResult } from '../tools/LSTool.js';
import { DockerContainerManager, ContainerInfo } from './DockerContainerManager.js';
import { LogCategory } from './logger.js';
import { AgentEvents, AgentEventType, EnvironmentStatusEvent } from './sessionUtils.js';
import { GitRepositoryInfo } from '../types/repository.js';
import { GitInfoHelper } from './GitInfoHelper.js';

/**
 * Execution adapter that runs commands in a Docker container
 */
export class DockerExecutionAdapter implements ExecutionAdapter {
  private containerManager: DockerContainerManager;
  private logger?: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  private lastEmittedStatus?: 'initializing' | 'connecting' | 'connected' | 'disconnected' | 'error';
  
  // Git information helper for optimized git operations
  private gitInfoHelper: GitInfoHelper;
  public initialized = false;

  /**
   * Create a Docker execution adapter with a container manager
   */
  constructor(
    containerManager: DockerContainerManager,
    options?: {
      logger?: {
        debug: (message: string, ...args: unknown[]) => void;
        info: (message: string, ...args: unknown[]) => void;
        warn: (message: string, ...args: unknown[]) => void;
        error: (message: string, ...args: unknown[]) => void;
      }
    }
  ) {
    this.containerManager = containerManager;
    this.logger = options?.logger;
    
    // Initialize git helper with same logger
    this.gitInfoHelper = new GitInfoHelper({ logger: this.logger });
    
    // Start container initialization immediately in the background
    // Fire and forget - we don't await this promise in the constructor
    this.initializeContainer().then(() => {
      this.initialized = true;
    }).catch(error => {
      this.logger?.error(`Background Docker initialization failed: ${(error as Error).message}`, error, LogCategory.SYSTEM);
    });
  }
  
  /**
   * Initialize the Docker container in the background
   * This allows eager initialization without blocking construction
   * @returns Promise that resolves when container is initialized
   */
  public initializeContainer(): Promise<ContainerInfo | null> {
    this.logger?.info('Starting Docker container initialization', LogCategory.SYSTEM);
    
    // Emit initializing status
    this.emitEnvironmentStatus('initializing', false);
    
    // Return the promise instead of using .then() so caller can await if needed
    return this.containerManager.ensureContainer()
      .then(container => {
        if (container) {
          this.logger?.info('Docker container initialized successfully', LogCategory.SYSTEM);
          
          // Emit connected and ready status
          this.emitEnvironmentStatus('connected', true);
        } else {
          this.logger?.warn('Docker container initialization failed', LogCategory.SYSTEM);
          
          // Emit error status
          this.emitEnvironmentStatus('error', false, 'Failed to initialize Docker container');
        }
        return container;
      })
      .catch(error => {
        this.logger?.error(`Error initializing Docker container: ${(error as Error).message}`, error, LogCategory.SYSTEM);
        
        // Emit error status
        this.emitEnvironmentStatus('error', false, (error as Error).message);
        
        throw error;
      });
  }
  
  /**
   * Emit environment status event
   */
  private emitEnvironmentStatus(
    status: 'initializing' | 'connecting' | 'connected' | 'disconnected' | 'error',
    isReady: boolean,
    error?: string
  ): void {
    // Skip if this status was already emitted
    if (this.lastEmittedStatus === status) {
      this.logger?.debug(`Skipping duplicate Docker environment status: ${status}`, LogCategory.SYSTEM);
      return;
    }
    
    // Special handling for "initializing" status - only emit if previously disconnected or error
    if (status === 'initializing' && 
        this.lastEmittedStatus && 
        !['disconnected', 'error', undefined].includes(this.lastEmittedStatus)) {
      this.logger?.debug(`Skipping redundant initializing status (current: ${this.lastEmittedStatus})`, LogCategory.SYSTEM);
      return;
    }

    // Update last emitted status
    this.lastEmittedStatus = status;
    
    const statusEvent: EnvironmentStatusEvent = {
      environmentType: 'docker',
      status,
      isReady,
      error
    };
    
    this.logger?.info(`Emitting Docker environment status: ${status}, ready=${isReady}`, LogCategory.SYSTEM);
    if (error) {
      this.logger?.error(`Docker environment status error: ${error}`, LogCategory.SYSTEM);
    }
    AgentEvents.emit(AgentEventType.ENVIRONMENT_STATUS_CHANGED, statusEvent);
  }

  /**
   * Execute a command in the Docker container
   */
  async executeCommand(executionId: string, command: string, workingDir?: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    try {
      // Convert working directory to container path if provided
      let containerWorkingDir: string | undefined;
      
      if (workingDir) {
        const containerInfo = await this.containerManager.getContainerInfo();
        if (!containerInfo) {
          throw new Error('Container is not available');
        }
        
        containerWorkingDir = this.toContainerPath(workingDir, containerInfo);
      }
      
      this.logger?.debug(`Executing command in container: ${command}`, LogCategory.TOOLS);
      
      // Try to execute the command
      try {
        const result = await this.containerManager.executeCommand(command, containerWorkingDir);
        return result;
      } catch (error) {
        // Check if container needs to be restarted
        if ((error as Error).message.includes('container not running') || 
            (error as Error).message.includes('No such container')) {
          
          this.logger?.warn('Container not running, attempting to restart', LogCategory.TOOLS);
          
          // Update status to disconnected before restarting
          this.emitEnvironmentStatus('disconnected', false);
          
          // Try to restart container
          const containerInfo = await this.containerManager.ensureContainer();
          if (!containerInfo) {
            this.emitEnvironmentStatus('error', false, 'Failed to restart container');
            throw new Error('Failed to restart container');
          }
          
          // Reconnected successfully
          this.emitEnvironmentStatus('connected', true);
          
          // Retry command after restart
          const retryResult = await this.containerManager.executeCommand(command, containerWorkingDir);
          return retryResult;
        }
        
        // If it's not a container availability issue, rethrow
        throw error;
      }
    } catch (error) {
      this.logger?.error(`Error executing command in container: ${(error as Error).message}`, error, LogCategory.TOOLS);
      return {
        stdout: '',
        stderr: `Error executing command: ${(error as Error).message}`,
        exitCode: 1
      };
    }
  }

  /**
   * Read a file from the container
   */
  async readFile(executionId: string, filepath: string, maxSize?: number, lineOffset?: number, lineCount?: number, encoding?: string): Promise<FileReadToolSuccessResult | FileReadToolErrorResult> {
    try {
      if (!encoding) {
        encoding = 'utf8';
      }
      if (!maxSize) {
        maxSize = 1048576; // 1MB default
      }
      if (!lineOffset) {
        lineOffset = 0;
      }
      
      // Get container info
      const containerInfo = await this.containerManager.getContainerInfo();
      if (!containerInfo) {
        return {
          success: false as const,
          path: filepath,
          error: 'Container is not available'
        };
      }
      
      // Convert to container path
      const containerPath = this.toContainerPath(filepath, containerInfo);
      
      // Check if file exists
      const { exitCode: fileExists } = await this.executeCommand(executionId, `[ -f "${containerPath}" ]`);
      if (fileExists !== 0) {
        // Format path for display
        const displayPath = this.formatPathForDisplay(filepath, containerInfo);
        
        return {
          success: false as const,
          path: filepath,
          displayPath,
          error: `File does not exist: ${displayPath}`
        };
      }
      
      // Check file size
      const { stdout: fileSizeStr } = await this.executeCommand(executionId, `stat -c %s "${containerPath}"`);
      const fileSize = parseInt(fileSizeStr.trim(), 10);
      
      if (isNaN(fileSize)) {
        // Format path for display
        const displayPath = this.formatPathForDisplay(filepath, containerInfo);
        
        return {
          success: false as const,
          path: filepath,
          displayPath,
          error: `Unable to determine file size: ${displayPath}`
        };
      }
      
      if (fileSize > maxSize) {
        // Format path for display
        const displayPath = this.formatPathForDisplay(filepath, containerInfo);
        
        return {
          success: false as const,
          path: filepath,
          displayPath,
          error: `File is too large (${fileSize} bytes) to read. Max size: ${maxSize} bytes`
        };
      }
      
      // Read file content
      let command = `nl "${containerPath}"`;
      if (lineOffset > 0 || lineCount !== undefined) {
        command = `head -n ${lineOffset + (lineCount || 0)} "${containerPath}" | tail -n ${lineCount || '+0'} | nl -v ${lineOffset + 1}`;
      }
      
      const { stdout: content, stderr, exitCode } = await this.executeCommand(executionId, command);
      
      if (exitCode !== 0) {
        return {
          success: false as const,
          path: filepath,
          error: stderr || `Failed to read file: ${filepath}`
        };
      }
      
      // If we need to report pagination info
      if (lineOffset > 0 || lineCount !== undefined) {
        // Get total lines
        const { stdout: lineCountStr } = await this.executeCommand(executionId, `wc -l < "${containerPath}"`);
        const totalLines = parseInt(lineCountStr.trim(), 10);
        
        const startLine = lineOffset;
        const endLine = lineCount !== undefined 
          ? Math.min(startLine + lineCount, totalLines) 
          : totalLines;
        
        // Format path for display
        const displayPath = this.formatPathForDisplay(filepath, containerInfo);
        
        return {
          success: true as const,
          path: filepath,
          displayPath, // Add formatted path for UI display
          content: content,
          size: fileSize,
          encoding,
          pagination: {
            totalLines,
            startLine,
            endLine,
            hasMore: endLine < totalLines
          }
        };
      }
      
      // Format path for display
      const displayPath = this.formatPathForDisplay(filepath, containerInfo);
      
      return {
        success: true as const,
        path: filepath,
        displayPath, // Add formatted path for UI display
        content: content,
        size: fileSize,
        encoding
      };
    } catch (error) {
      return {
        success: false as const,
        path: filepath,
        error: `Error reading file: ${(error as Error).message}`
      };
    }
  }

  /**
   * Write content to a file in the container
   */
  async writeFile(executionId: string, filepath: string, content: string): Promise<void> {
    try {
      // Get container info
      const containerInfo = await this.containerManager.getContainerInfo();
      if (!containerInfo) {
        throw new Error('Container is not available');
      }
      
      // Make sure the path is within the working directory
      if (!this.isPathWithinWorkingDir(filepath, containerInfo)) {
        throw new Error(`Security constraint: Can only write to paths within the working directory. Attempted to write to ${filepath}`);
      }
      
      const containerPath = this.toContainerPath(filepath, containerInfo);
      
      // Create directory if it doesn't exist
      await this.executeCommand(executionId, `mkdir -p "$(dirname "${containerPath}")"`);
      
      // The issue appears to be with the heredoc approach truncating content
      // Use a more robust two-step approach: write to temp file then copy it
      
      // Generate a temporary file name
      const tempFileName = `temp_file_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const tempFilePath = `/tmp/${tempFileName}`;
      
      // Write content to temporary file (split into chunks if necessary to avoid command length issues)
      const maxChunkSize = 1024 * 512; // 512KB chunks
      
      if (content.length > maxChunkSize) {
        // For large files, write in chunks
        await this.executeCommand(executionId, `touch "${tempFilePath}"`); // Create empty file
        
        // Write content in chunks
        for (let i = 0; i < content.length; i += maxChunkSize) {
          const chunk = content.substring(i, i + maxChunkSize);
          // Append chunk to temp file
          await this.executeCommand(executionId, `cat >> "${tempFilePath}" << 'CHUNK_EOF'\n${chunk}\nCHUNK_EOF`);
        }
      } else {
        // For smaller files, write in one go
        await this.executeCommand(executionId, `cat > "${tempFilePath}" << 'EOF_QCKFX'\n${content}\nEOF_QCKFX`);
      }
      
      // Verify temp file was written correctly
      const { stdout: verifySize } = await this.executeCommand(executionId, `stat -c %s "${tempFilePath}"`);
      const tempFileSize = parseInt(verifySize.trim(), 10);
      
      if (isNaN(tempFileSize) || tempFileSize === 0) {
        throw new Error(`Failed to write temporary file: file size verification failed (size: ${tempFileSize})`);
      }
      
      // Move temp file to destination
      await this.executeCommand(executionId, `cp "${tempFilePath}" "${containerPath}" && rm "${tempFilePath}"`);
      
      // Verify destination file was written correctly
      const { stdout: finalSize } = await this.executeCommand(executionId, `stat -c %s "${containerPath}"`);
      const finalFileSize = parseInt(finalSize.trim(), 10);
      
      if (isNaN(finalFileSize) || finalFileSize === 0) {
        throw new Error(`Failed to write file: file size verification failed (size: ${finalFileSize})`);
      }
      
      // Log success with file sizes for debugging
      this.logger?.debug(`File write successful: ${filepath}`, 'tools', {
        contentLength: content.length,
        tempFileSize,
        finalFileSize
      });
    } catch (error) {
      throw new Error(`Failed to write file: ${(error as Error).message}`);
    }
  }

  /**
   * Edit a file by replacing content
   * Uses a binary-safe approach to handle files with special characters
   */
  async editFile(executionId: string, filepath: string, searchCode: string, replaceCode: string, encoding?: string): Promise<FileEditToolSuccessResult | FileEditToolErrorResult> {
    if (!encoding) {
      encoding = 'utf8';
    }
    
    try {
      // Get container info
      const containerInfo = await this.containerManager.getContainerInfo();
      if (!containerInfo) {
        return {
          success: false as const,
          path: filepath,
          error: 'Container is not available'
        };
      }
      
      // Make sure the path is within the working directory
      if (!this.isPathWithinWorkingDir(filepath, containerInfo)) {
        return {
          success: false as const,
          path: filepath,
          error: `Security constraint: Can only modify files within the working directory. Attempted to modify ${filepath}`
        };
      }
      
      // For the UI display, we want to read with line numbers (for the UI only)
      const fileResult = await this.readFile(executionId, filepath);
      if (!fileResult.success) {
        return {
          success: false as const,
          path: filepath,
          displayPath: this.formatPathForDisplay(filepath, containerInfo),
          error: fileResult.error
        };
      }
      
      // The numbered content is for display purposes only
      const displayContent = fileResult.content;
      
      // Binary-safe approach using temporary files to avoid escaping issues
      // Create a unique identifier for this operation to avoid conflicts
      const opId = `edit_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
      const containerPath = this.toContainerPath(filepath, containerInfo);
      const tempDir = `/tmp/${opId}`;
      const searchFile = `${tempDir}/search`;
      const replaceFile = `${tempDir}/replace`;
      const originalFile = `${tempDir}/original`;
      const newFile = `${tempDir}/new`;
      
      try {
        // Create temporary directory
        await this.executeCommand(executionId, `mkdir -p "${tempDir}"`);
        
        // Normalize line endings consistently (only this normalization)
        const normalizedSearchCode = searchCode.replace(/\r\n/g, '\n');
        const normalizedReplaceCode = replaceCode.replace(/\r\n/g, '\n');
        
        // Write search and replace content to temporary files using base64 to preserve all characters
        await this.executeCommand(executionId, `echo '${Buffer.from(normalizedSearchCode).toString('base64')}' | base64 -d > "${searchFile}"`);
        await this.executeCommand(executionId, `echo '${Buffer.from(normalizedReplaceCode).toString('base64')}' | base64 -d > "${replaceFile}"`);
        
        // Make a copy of the original file for processing
        await this.executeCommand(executionId, `cp "${containerPath}" "${originalFile}"`);
        
        // Fix line endings in original file if needed (normalize to Unix)
        await this.executeCommand(executionId, `tr -d '\\r' < "${originalFile}" > "${originalFile}.unix" && mv "${originalFile}.unix" "${originalFile}"`);
        
        // Use the pre-installed binary-replace.sh script
        // This avoids creating a script on the fly and is more reliable
        this.logger?.debug(`Running binary-replace.sh to edit file: ${originalFile}`, LogCategory.TOOLS);
        
        // Verify the binary-replace.sh script exists
        const { exitCode: scriptExists } = await this.executeCommand(executionId, `which binary-replace.sh`);
        if (scriptExists !== 0) {
          throw new Error("The binary-replace.sh script is not available in the container");
        }
        
        // Execute the pre-installed binary replacement script with debug output
        this.logger?.debug(`Executing: binary-replace.sh "${originalFile}" "${searchFile}" "${replaceFile}" "${newFile}"`, LogCategory.TOOLS);
        
        // Run with additional logging and error handling
        let scriptOutput = '';
        let scriptError = '';
        let scriptExitCode = 1; // Default to error
        
        try {
          // Check that all files exist before running the script
          const { exitCode: origExists } = await this.executeCommand(executionId, `[ -f "${originalFile}" ]`);
          const { exitCode: searchExists } = await this.executeCommand(executionId, `[ -f "${searchFile}" ]`);
          const { exitCode: replaceExists } = await this.executeCommand(executionId, `[ -f "${replaceFile}" ]`);
          
          if (origExists !== 0 || searchExists !== 0 || replaceExists !== 0) {
            throw new Error("One or more required files do not exist");
          }
          
          // Explicitly check write permissions to container path 
          const { exitCode: writeCheck, stderr: writeCheckErr } = await this.executeCommand(executionId, `touch "${containerPath}.writecheck" && rm "${containerPath}.writecheck"`);
          
          if (writeCheck !== 0) {
            throw new Error(`No write permission for file: ${containerPath}`);
          }
          
          // Run the script with full error output
          const result = await this.executeCommand(executionId,
            `binary-replace.sh "${originalFile}" "${searchFile}" "${replaceFile}" "${newFile}" 2>&1`
          );
          
          scriptOutput = result.stdout;
          scriptError = result.stderr;
          scriptExitCode = result.exitCode;
          
          
          // Verify the output file exists after script execution
          const { exitCode: outputExists } = await this.executeCommand(executionId, `[ -f "${newFile}" ] && echo "Output file exists" || echo "Output file missing"`);
        } catch (execError) {
          console.error(`[ERROR] Failed to execute binary-replace.sh: ${(execError as Error).message}`);
          // We'll set error message but continue to handle it in the next section
          scriptError = (execError as Error).message;
        }
        
        // Check script exit code
        // Handle script exit codes based on our binary-replace.sh script
        if (scriptExitCode === 2) {
          // Pattern not found (now exit code 2 in our script)
          await this.executeCommand(executionId, `rm -rf "${tempDir}"`);
          
          const displayPath = this.formatPathForDisplay(filepath, containerInfo);
          return {
            success: false as const,
            path: filepath,
            displayPath,
            error: `Search pattern not found in file: ${displayPath}`
          };
        }
        
        if (scriptExitCode === 3) {
          // Multiple occurrences found (now exit code 3 in our script)
          await this.executeCommand(executionId, `rm -rf "${tempDir}"`);
          
          const displayPath = this.formatPathForDisplay(filepath, containerInfo);
          return {
            success: false as const,
            path: filepath,
            displayPath,
            error: `Found multiple instances of the search pattern. Please provide a more specific search pattern that matches exactly once.`
          };
        }
        
        if (scriptExitCode !== 0) {
          // Other error
          await this.executeCommand(executionId, `rm -rf "${tempDir}"`);
          
          const displayPath = this.formatPathForDisplay(filepath, containerInfo);
          return {
            success: false as const,
            path: filepath,
            displayPath,
            error: `Error during binary replacement: ${scriptError || scriptOutput || "Unknown error"}`
          };
        }
        
        // Verify the file was created and has content
        const { exitCode: newFileExists } = await this.executeCommand(executionId, `[ -f "${newFile}" ] && [ -s "${newFile}" ]`);
        if (newFileExists !== 0) {
          
          // Clean up temporary files
          await this.executeCommand(executionId, `rm -rf "${tempDir}"`);
          
          return {
            success: false as const,
            path: filepath,
            displayPath: this.formatPathForDisplay(filepath, containerInfo),
            error: `Failed to create edited file - binary replacement produced no output`
          };
        }
        
        // Copy the new file back to the original location
        await this.executeCommand(executionId, `cp "${newFile}" "${containerPath}"`);
        
        // Clean up temporary files
        await this.executeCommand(executionId, `rm -rf "${tempDir}"`);
      } catch (processingError) {
        // Clean up temporary files on error
        await this.executeCommand(executionId, `rm -rf "${tempDir}"`).catch(() => {
          // Ignore cleanup errors
        });
        
        throw processingError;
      }
      
      // For display purposes, we need to re-read the file with line numbers
      // to show the correct result with the line numbers intact
      const newFileResult = await this.readFile(executionId, filepath);
      
      // Log results of re-reading the file
      if (newFileResult.success) {
      } else {
      }
      
      // Format path for display
      const displayPath = this.formatPathForDisplay(filepath, containerInfo);
      
      return {
        success: true as const,
        path: filepath,
        displayPath,
        originalContent: displayContent, // Original numbered content for display
        newContent: newFileResult.success ? newFileResult.content : "Content updated but unavailable for display" // Show the new content with line numbers
      };
    } catch (error) {
      return {
        success: false as const,
        path: filepath,
        displayPath: filepath, // Use original path for display in case of early errors
        error: `Error editing file: ${(error as Error).message}`
      };
    }
  }

  /**
   * Find files matching a glob pattern
   */
  async glob(executionId: string, pattern: string, _options?: any): Promise<string[]> {
    try {
      // Get container info
      const containerInfo = await this.containerManager.getContainerInfo();
      if (!containerInfo) {
        return [];
      }
      
      // Convert to container path pattern if it starts with a path
      const containerPattern = pattern.startsWith('/') 
        ? this.toContainerPath(pattern, containerInfo)
        : pattern;
      
      // Use find command with -path for glob-like behavior
      const { stdout, exitCode } = await this.executeCommand(executionId, `find ${containerInfo.workspacePath} -path "${containerPattern}" -type f | sort`);
      
      if (exitCode !== 0 || !stdout.trim()) {
        return [];
      }
      
      // Convert container paths back to host paths
      return stdout.trim().split('\n')
        .filter(line => line.length > 0)
        .map(containerPath => this.toHostPath(containerPath, containerInfo));
    } catch (error) {
      this.logger?.error(`Error in glob: ${(error as Error).message}`, error, 'tools');
      return [];
    }
  }

  /**
   * List directory contents
   */
  async ls(executionId: string, dirPath: string, showHidden: boolean = false, details: boolean = false): Promise<LSToolSuccessResult | LSToolErrorResult> {
    try {
      // Get container info
      const containerInfo = await this.containerManager.getContainerInfo();
      if (!containerInfo) {
        return {
          success: false as const,
          path: dirPath,
          error: 'Container is not available'
        };
      }
      
      // Convert to container path
      const containerPath = this.toContainerPath(dirPath, containerInfo);
      
      // Check if directory exists
      const { exitCode } = await this.executeCommand(executionId, `[ -d "${containerPath}" ]`);
      
      if (exitCode !== 0) {
        return {
          success: false as const,
          path: dirPath,
          error: `Directory does not exist: ${dirPath}`
        };
      }
      
      // Get directory entries with a single command
      let command: string;
      
      if (details) {
        // Use BusyBox compatible commands instead of GNU find with -printf
        // Use ls -la for detailed listing with all information
        command = `ls -la "${containerPath}" ${showHidden ? '' : '| grep -v "^\\..*"'}`;
      } else {
        // Simple listing
        command = `ls -1${showHidden ? 'a' : ''} "${containerPath}" ${showHidden ? '' : '| grep -v "^\\..*"'}`;
      }
      
      const { stdout, stderr, exitCode: lsExitCode } = await this.executeCommand(executionId, command);
      
      if (lsExitCode !== 0) {
        return {
          success: false as const,
          path: dirPath,
          error: stderr || `Failed to list directory: ${dirPath}`
        };
      }
      
      // Parse entries
      const results: FileEntry[] = [];
      
      if (details) {
        // Parse the detailed output from ls -la
        // Example output: 
        // total 24
        // drwxr-xr-x 2 user user 4096 Apr 19 12:34 .
        // drwxr-xr-x 3 user user 4096 Apr 19 12:34 ..
        // -rw-r--r-- 1 user user  123 Apr 19 12:34 file.txt
        // drwxr-xr-x 2 user user 4096 Apr 19 12:34 dir
        // lrwxrwxrwx 1 user user    8 Apr 19 12:34 link -> file.txt
        
        const lines = stdout.trim().split('\n');
        
        // Skip the first line which shows the total size
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Split by whitespace, but be aware that filenames might contain spaces
          const parts = line.split(/\s+/);
          if (parts.length < 7) continue; // Need at least enough parts for a valid entry
          
          // First character of permissions indicates type
          const typeChar = parts[0][0];
          const isDirectory = typeChar === 'd';
          const isSymbolicLink = typeChar === 'l';
          const isFile = typeChar === '-';
          
          // Determine the entry name - it's everything after the timestamp
          // This is tricky because filenames can have spaces
          const dateTimeParts = 5; // Assuming we have at least "Apr 19 12:34" (5 parts)
          const nameStart = parts.slice(0, 5 + dateTimeParts).join(' ').length + 1;
          let name = line.substring(nameStart).trim();
          
          // For symlinks, remove the " -> target" part
          if (isSymbolicLink && name.includes(' -> ')) {
            name = name.split(' -> ')[0];
          }
          
          // Skip . and .. entries
          if (name === '.' || name === '..') continue;
          
          // Get the size
          const size = parseInt(parts[4], 10);
          
          // Add the entry
          results.push({
            name,
            type: isDirectory ? 'directory' : isFile ? 'file' : isSymbolicLink ? 'symlink' : 'other',
            size: isNaN(size) ? 0 : size,
            isDirectory,
            isFile,
            isSymbolicLink
          });
        }
        
        // Log the results for debugging
        this.logger?.debug(`Parsed ${results.length} entries from ls -la output`, LogCategory.TOOLS);
      } else {
        // For simple listing, just do an ls -la anyway to get the file types correctly
        // This avoids multiple commands and is more efficient
        const { stdout: detailedOutput } = await this.executeCommand(executionId, `ls -la "${containerPath}"`);
        const detailedLines = detailedOutput.trim().split('\n');
        
        // Parse detailed output to get file types
        const typeMap = new Map<string, { isDir: boolean, isFile: boolean, isLink: boolean }>();
        
        // Skip the first line which shows the total size
        for (let i = 1; i < detailedLines.length; i++) {
          const line = detailedLines[i].trim();
          if (!line) continue;
          
          // Split by whitespace
          const parts = line.split(/\s+/);
          if (parts.length < 7) continue;
          
          // First character of permissions indicates type
          const typeChar = parts[0][0];
          
          // Determine the entry name
          const dateTimeParts = 5; // Assuming we have at least "Apr 19 12:34" (5 parts)
          const nameStart = parts.slice(0, 5 + dateTimeParts).join(' ').length + 1;
          let name = line.substring(nameStart).trim();
          
          // For symlinks, remove the " -> target" part
          if (typeChar === 'l' && name.includes(' -> ')) {
            name = name.split(' -> ')[0];
          }
          
          // Skip . and .. entries
          if (name === '.' || name === '..') continue;
          
          // Skip hidden files if not showing them
          if (!showHidden && name.startsWith('.')) continue;
          
          typeMap.set(name, {
            isDir: typeChar === 'd',
            isFile: typeChar === '-',
            isLink: typeChar === 'l'
          });
        }
        
        // Now process the simple listing
        const entries = stdout.trim().split('\n')
          .filter(name => name && name !== '.' && name !== '..');
        
        for (const name of entries) {
          const typeInfo = typeMap.get(name) || { isDir: false, isFile: true, isLink: false };
          
          let type = 'file'; // default to file
          if (typeInfo.isDir) type = 'directory';
          else if (typeInfo.isLink) type = 'symlink';
          
          results.push({
            name,
            type,
            isDirectory: typeInfo.isDir,
            isFile: typeInfo.isFile,
            isSymbolicLink: typeInfo.isLink
          });
        }
      }
      
      return {
        success: true as const,
        path: dirPath,
        entries: results,
        count: results.length
      };
    } catch (error) {
      this.logger?.error(`Error listing directory: ${(error as Error).message}`, error, LogCategory.TOOLS);
      return {
        success: false as const,
        path: dirPath,
        error: `Error listing directory: ${(error as Error).message}`
      };
    }
  }

  /**
   * Convert a host path to a container path
   */
  private toContainerPath(hostPath: string, containerInfo: ContainerInfo): string {
    // If path is already a container path starting with workspace path, return as is
    if (hostPath === containerInfo.workspacePath || 
        (hostPath.startsWith(containerInfo.workspacePath) && 
         (hostPath.length === containerInfo.workspacePath.length || 
          hostPath[containerInfo.workspacePath.length] === '/'))) {
      return hostPath;
    }

    if (hostPath.startsWith('/tmp/')) {
      return hostPath;
    }
    
    // Ensure absolute path – if the caller provided a relative path we treat
    // it as relative to the *project* root that was detected by the
    // DockerContainerManager instead of resolving it against `process.cwd()`.
    // This makes sure tools like FileReadTool, FileEditTool, FileWriteTool and
    // BashTool behave consistently regardless of where the JS process was
    // launched from (e.g. inside node_modules when installed as a dependency).

    const absolutePath = path.isAbsolute(hostPath)
      ? hostPath
      : path.resolve(containerInfo.projectPath, hostPath);
    
    // Check if path is within project directory
    if (absolutePath.startsWith(containerInfo.projectPath)) {
      return path.join(
        containerInfo.workspacePath,
        path.relative(containerInfo.projectPath, absolutePath)
      );
    }
    
    // For paths outside project directory, throw error
    throw new Error(`Path is outside project directory: ${hostPath}`);
  }

  /**
   * Convert a container path to a host path
   */
  private toHostPath(containerPath: string, containerInfo: ContainerInfo): string {
    if (containerPath.startsWith(containerInfo.workspacePath)) {
      return path.join(
        containerInfo.projectPath,
        containerPath.substring(containerInfo.workspacePath.length + 1)
      );
    }
    return containerPath;
  }
  
  /**
   * Format a path for display by converting absolute paths to relative ones
   * This is used in tool results to show more user-friendly paths
   */
  private formatPathForDisplay(absolutePath: string, containerInfo: ContainerInfo): string {
    // If it's a container path, convert to relative project path
    if (absolutePath.startsWith(containerInfo.workspacePath)) {
      return path.posix.relative(containerInfo.workspacePath, absolutePath);
    }
    
    // If it's a host path, try to make it relative to the project directory
    if (absolutePath.startsWith(containerInfo.projectPath)) {
      return path.relative(containerInfo.projectPath, absolutePath);
    }
    
    // If path is outside known directories, return as is
    return absolutePath;
  }

  /**
   * Check if a path is within the working directory
   */
  private isPathWithinWorkingDir(filepath: string, containerInfo: ContainerInfo): boolean {
    // Special case for workspace path inside container
    if (filepath === containerInfo.workspacePath) {
      return true;
    }

    // Allow /tmp directory access
    if (filepath.startsWith('/tmp/')) {
      return true;
    }
    
    const absolutePath = path.isAbsolute(filepath)
      ? filepath
      : path.resolve(containerInfo.projectPath, filepath);
    
    return absolutePath.startsWith(containerInfo.projectPath);
  }

  /**
   * Generates a structured directory map for the specified path
   * @param rootPath The root directory to map
   * @param maxDepth Maximum depth to traverse (default: 10)
   * @returns A formatted directory structure as a string
   */
  async generateDirectoryMap(rootPath: string, maxDepth: number = 10): Promise<string> {
    try {
      console.log(`DockerExecutionAdapter: Generating directory map for ${rootPath} with max depth ${maxDepth}`);
      
      // Run the directory-mapper.sh script in the container
      const scriptPath = `/usr/local/bin/directory-mapper.sh`;
      const result = await this.executeCommand('docker-directory-mapper', `${scriptPath} "${rootPath}" ${maxDepth}`);
      
      if (result.exitCode !== 0) {
        throw new Error(`Failed to generate directory structure: ${result.stderr}`);
      }
      
      console.log(`DockerExecutionAdapter: Directory map generated successfully: ${result.stdout}`);
      return result.stdout;
    } catch (error) {
      console.error(`DockerExecutionAdapter: Error generating directory map: ${(error as Error).message}`);
      
      // Return a basic fallback structure on error
      return `<context name="directoryStructure">Below is a snapshot of this project's file structure at the start of the conversation. This snapshot will NOT update during the conversation. It skips over .gitignore patterns.

- ${rootPath}/
  - (Error mapping directory structure)
</context>`;
    }
  }
  
  /**
   * Retrieves git repository information for the current directory in the container
   * Using the optimized GitInfoHelper for maximum performance
   * @returns Git repository information or null if not a git repository
   */
  async getGitRepositoryInfo(): Promise<GitRepositoryInfo | null> {
    try {
      // Check if container is ready
      const containerInfo = await this.containerManager.getContainerInfo();
      if (!containerInfo) {
        this.logger?.warn('Container is not ready, cannot get git repository information', LogCategory.SYSTEM);
        return null;
      }
      
      // Get container working directory
      const workingDir = containerInfo.workspacePath;
      
      // Use the GitInfoHelper with a custom command executor that executes in the Docker container
      return await this.gitInfoHelper.getGitRepositoryInfo(async (command) => {
        // Prepend cd to the working directory for all git commands
        const containerCommand = `cd "${workingDir}" && ${command}`;
        return await this.executeCommand('docker-git-info', containerCommand);
      });
    } catch (error) {
      this.logger?.error('Error retrieving git repository information from container:', error, LogCategory.SYSTEM);
      return null;
    }
  }
}