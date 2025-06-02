import { exec } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import { ExecutionAdapter } from '../types/tool.js';
import path from 'path';
import { glob } from 'glob';
import { FileEntry } from '../tools/LSTool.js';
import { LogCategory, Logger } from './logger.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import { BusEvents, BusEvent } from '../types/bus-events.js';
import os from 'os';
import { GitRepositoryInfo } from '../types/repository.js';
import { GitInfoHelper } from './GitInfoHelper.js';
import { MultiRepoManager } from './MultiRepoManager.js';
import { EnvironmentStatusEvent } from './sessionUtils.js';

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdtempAsync = promisify(fs.mkdtemp);
const mkdirAsync = promisify(fs.mkdir);

export class LocalExecutionAdapter implements ExecutionAdapter {
  private sessionId: string;
  private logger?: Logger;
  
  // Git information helper for optimized git operations
  private gitInfoHelper: GitInfoHelper;
  
  // Multi-repo manager for handling multiple repositories
  private multiRepoManager: MultiRepoManager;


  private eventBus: TypedEventEmitter<BusEvents>;

  constructor(sessionId: string, options: { 
    logger?: Logger;
    eventBus: TypedEventEmitter<BusEvents>;
  }) {
    this.sessionId = sessionId;
    this.logger = options.logger;
    this.eventBus = options.eventBus;
    
    // Initialize git helper with same logger
    this.gitInfoHelper = new GitInfoHelper({ logger: this.logger });
    
    // Initialize multi-repo manager with current working directory
    this.multiRepoManager = new MultiRepoManager(process.cwd());
    
    // Emit environment status as ready immediately for local adapter
    this.emitEnvironmentStatus('connected', true);
  }
  
  /**
   * Emit environment status event
   */
  private emitEnvironmentStatus(
    status: 'initializing' | 'connecting' | 'connected' | 'disconnected' | 'error',
    isReady: boolean,
    error?: string
  ): void {
    const statusEvent: EnvironmentStatusEvent = {
      environmentType: 'local',
      status,
      isReady,
      error
    };
    
    this.logger?.info(`Emitting local environment status: ${status}, ready=${isReady}`, LogCategory.SYSTEM);
    this.eventBus.emit(BusEvent.ENVIRONMENT_STATUS_CHANGED, {
      sessionId: this.sessionId,
      ...statusEvent
    });
  }
  async executeCommand(executionId: string, command: string, workingDir?: string) {
    try {
      const options = workingDir ? { cwd: workingDir } : undefined;
      const result = await execAsync(command, options);
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: 0
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        return {
          stdout: '',
          stderr: error.message,
          exitCode: 1
        };
      }
      return {
        stdout: '',
        stderr: 'Unknown error',
        exitCode: 1
      };
    }
  }

  /**
   * Edit a file by replacing content
   * Uses a binary-safe approach to handle files with special characters and line endings
   */
  async editFile(executionId: string, filepath: string, searchCode: string, replaceCode: string, encoding?: string) {
    if (!encoding) {
      encoding = 'utf8';
    }
    try {
      // Resolve the path
      const resolvedPath = path.resolve(filepath);
      
      // Check if file exists
      let fileContent = '';
      
      try {
        const stats = await fs.promises.stat(resolvedPath);
        if (!stats.isFile()) {
          return {
            ok: false as const,
            error: `Path exists but is not a file: ${filepath}`
          };
        }
        
        // Read file content for analysis
        fileContent = (await readFileAsync(resolvedPath, encoding as BufferEncoding)).toString();
      } catch (error: unknown) {
        const err = error as Error & { code?: string };
        if (err.code === 'ENOENT') {
          return {
            ok: false as const,
            error: `File does not exist: ${filepath}`
          };
        } else {
          throw error; // Re-throw unexpected errors
        }
      }
      
      // Normalize line endings to ensure consistent handling
      const normalizedContent = fileContent.replace(/\r\n/g, '\n');
      const normalizedSearchCode = searchCode.replace(/\r\n/g, '\n');
      const normalizedReplaceCode = replaceCode.replace(/\r\n/g, '\n');
      
      // Count occurrences of the search code in the normalized content
      const occurrences = normalizedContent.split(normalizedSearchCode).length - 1;
      
      if (occurrences === 0) {
        return {
          ok: false as const,
          error: `Search code not found in file: ${filepath}`
        };
      }
      
      if (occurrences > 1) {
        return {
          ok: false as const,
          error: `Found ${occurrences} instances of the search code. Please provide a more specific search code that matches exactly once.`
        };
      }
      
      // Create a temporary directory for our work files
      const tempDir = await mkdtempAsync(path.join(os.tmpdir(), 'qckfx-edit-'));
      
      try {
        this.logger?.debug(`Using binary-safe replacement with temp directory: ${tempDir}`, LogCategory.TOOLS);
        
        // Create temporary files for the search pattern, replacement, and original content
        const searchFile = path.join(tempDir, 'search');
        const replaceFile = path.join(tempDir, 'replace');
        const originalFile = path.join(tempDir, 'original');
        const newFile = path.join(tempDir, 'new');
        
        // Write content to temporary files
        await writeFileAsync(searchFile, normalizedSearchCode);
        await writeFileAsync(replaceFile, normalizedReplaceCode);
        await writeFileAsync(originalFile, fileContent);
        
        // Check if our binary-replace script is available
        const binaryReplaceScript = path.resolve(__dirname, '..', '..', 'scripts', 'binary-replace.sh');
        let binaryReplaceExists = false;
        
        try {
          await fs.promises.access(binaryReplaceScript, fs.constants.X_OK);
          binaryReplaceExists = true;
          this.logger?.debug(`Using binary-replace script at: ${binaryReplaceScript}`, LogCategory.TOOLS);
        } catch (err) {
          this.logger?.warn(`Binary-replace script not found or not executable at: ${binaryReplaceScript}`, LogCategory.TOOLS);
          binaryReplaceExists = false;
        }
        
        let newContent: string;
        
        if (binaryReplaceExists) {
          // Execute the binary-replace script to do the replacement
          try {
            const { exitCode, stdout, stderr } = 
              await this.executeCommand(executionId, `"${binaryReplaceScript}" "${originalFile}" "${searchFile}" "${replaceFile}" "${newFile}"`);
            
            if (exitCode !== 0) {
              // Handle specific exit codes from the script
              if (exitCode === 2) {
                throw new Error(`Search pattern not found in file: ${filepath}`);
              } else if (exitCode === 3) {
                throw new Error(`Multiple instances of the search pattern found in file: ${filepath}`);
              } else {
                throw new Error(`Binary replacement script failed: ${stderr || stdout || 'Unknown error'}`);
              }
            }
            
            // Read the new content after successful replacement
            newContent = (await readFileAsync(newFile, encoding as BufferEncoding)).toString();
          } catch (scriptError) {
            throw new Error(`Binary replacement failed: ${(scriptError as Error).message}`);
          }
        } else {
          // Fallback to the string-based approach if the script isn't available
          this.logger?.warn('Falling back to string-based replacement', LogCategory.TOOLS);
          
          // Use string replacement with careful handling of newlines
          const searchIndex = normalizedContent.indexOf(normalizedSearchCode);
          if (searchIndex === -1) {
            throw new Error(`Search pattern not found in file: ${filepath}`);
          }
          
          const prefixContent = normalizedContent.substring(0, searchIndex);
          const suffixContent = normalizedContent.substring(searchIndex + normalizedSearchCode.length);
          
          // Construct the new content with proper newline preservation
          newContent = prefixContent + normalizedReplaceCode + suffixContent;
          
          // Add diagnostic logging for newline debugging
          this.logger?.debug('File edit newline preservation check:', LogCategory.TOOLS, {
            searchEndsWithNewline: normalizedSearchCode.endsWith('\n'),
            replaceEndsWithNewline: normalizedReplaceCode.endsWith('\n'),
            suffixStartsWithNewline: suffixContent.startsWith('\n')
          });
        }
        
        // Write the updated content back to the original file
        await writeFileAsync(resolvedPath, newContent, encoding as BufferEncoding);
        
        // Clean up temporary directory
        await this.executeCommand(executionId, `rm -rf "${tempDir}"`);
        
        return {
          ok: true as const,
          data: {
            path: resolvedPath,
            originalContent: fileContent,
            newContent: newContent
          }
        };
      } catch (processingError) {
        // Clean up temporary directory on error
        await this.executeCommand(executionId, `rm -rf "${tempDir}"`).catch(() => {
          // Ignore cleanup errors
        });
        
        throw processingError;
      }
    } catch (error: unknown) {
      const err = error as Error;
      return {
        ok: false as const,
        error: err.message
      };
    }
  }

  async glob(executionId: string, pattern: string, options: any = {}): Promise<string[]> {
    return glob(pattern, options) as Promise<string[]>;
  }

  async readFile(executionId: string, filepath: string, maxSize?: number, lineOffset?: number, lineCount?: number, encoding?: string) {
    if (!encoding) {
      encoding = 'utf8';
    }
    if (!maxSize) {
      maxSize = 1048576;
    }
    if (!lineOffset) {
      lineOffset = 0;
    }
    
    // Resolve the path (could add security checks here)
    const resolvedPath = path.resolve(filepath);
      
    // Check if file exists and get stats
    const stats = await fs.promises.stat(resolvedPath);
    
    if (!stats.isFile()) {
      return {
        ok: false as const,
        error: `Path exists but is not a file: ${filepath}`
      };
    }
    
    // Check file size
    if (stats.size > maxSize) {
      return {
        ok: false as const,
        error: `File is too large (${stats.size} bytes) to read. Max size: ${maxSize} bytes`
      };
    }
    
    // Special handling for binary/base64 encoding
    if (encoding === 'base64' || encoding === 'binary') {
      try {
        // Read the file directly as a Buffer
        const data = await fs.promises.readFile(resolvedPath);
        // Convert to base64 string for consistent representation
        const base64Content = data.toString('base64');
        
        return {
          ok: true as const,
          data: {
            path: resolvedPath,
            content: base64Content,
            size: data.length,
            encoding: 'base64'
          }
        };
      } catch (error) {
        return {
          ok: false as const,
          error: `Failed to read file in ${encoding} mode: ${(error as Error).message}`
        };
      }
    }
    
    // ------------------------------------------------------
    // TEXT FILE HANDLING (utf-8 and friends)
    // ------------------------------------------------------
    // The previous implementation relied on spawning external
    // `head`, `tail` and `nl` commands. That approach had a few
    // drawbacks:
    //   1. Performance – every invocation spawns a new shell
    //      process which is noticeably slower, especially on
    //      macOS and even more so on Windows where GNU coreutils
    //      are not available by default.
    //   2. Portability – `nl` is not shipped with the default
    //      Windows environment leading to runtime failures.
    //   3. Correctness – once the command already paginated the
    //      output, we were slicing the text a second time which
    //      produced empty results for many (offset, count)
    //      combinations.
    //
    // Given that FileReadTool imposes a hard 500 kB limit (and
    // passes the requested `maxSize` to this adapter) it is safe
    // and much faster to read the file directly into memory and
    // perform the minimal pagination/numbering logic in JS.

    // Read the entire file – we have already checked that it does
    // not exceed `maxSize`.
    const rawText = await fs.promises.readFile(resolvedPath, encoding as BufferEncoding);

    // Split into lines (preserve empty trailing line if present)
    const allLines = rawText.split(/\r?\n/);

    // Determine slice bounds
    const startIdx = Math.max(0, lineOffset);
    const endIdx = lineCount !== undefined ? Math.min(startIdx + lineCount, allLines.length) : allLines.length;

    const requestedLines = allLines.slice(startIdx, endIdx);

    // Prefix each line with its (1-based) number using a tab – the
    // same format that the `nl` utility would produce.
    const numbered = requestedLines.map((ln, i) => `${(startIdx + i + 1).toString().padStart(6, ' ')}\t${ln}`);

    const content = numbered.join('\n');

    return {
      ok: true as const,
      data: {
        path: resolvedPath,
        content,
        size: stats.size,
        encoding,
        pagination: {
          totalLines: allLines.length,
          startLine: startIdx,
          endLine: endIdx,
          hasMore: endIdx < allLines.length
        }
      }
    };
  } 

  /**
   * Write content to a file
   * Uses a more robust approach for handling larger files
   */
  async writeFile(executionId: string, filePath: string, content: string, encoding?: string) {
    if (!encoding) {
      encoding = 'utf8';
    }
    
    try {
      // Resolve the file path
      const resolvedPath = path.resolve(filePath);
      
      // Ensure parent directory exists
      const dirPath = path.dirname(resolvedPath);
      try {
        await fs.promises.access(dirPath);
      } catch (err) {
        // Create directory if it doesn't exist
        await mkdirAsync(dirPath, { recursive: true });
      }
      
      // For smaller files, write directly
      if (content.length < 1048576) { // 1MB threshold
        await writeFileAsync(resolvedPath, content, encoding as BufferEncoding);
      } else {
        // For larger files, use a temporary file approach to avoid memory issues
        this.logger?.debug(`Using chunked approach for large file (${content.length} bytes): ${filePath}`, LogCategory.TOOLS);
        
        // Create a temporary file
        const tempDir = await mkdtempAsync(path.join(os.tmpdir(), 'qckfx-write-'));
        const tempFile = path.join(tempDir, 'temp_content');
        
        try {
          // Write content to temp file
          await writeFileAsync(tempFile, content, encoding as BufferEncoding);
          
          // Verify temp file size
          const stats = await fs.promises.stat(tempFile);
          if (stats.size === 0) {
            throw new Error(`Failed to write temporary file: file size is 0 bytes`);
          }
          
          // Copy temp file to destination
          await fs.promises.copyFile(tempFile, resolvedPath);
          
          // Verify destination file
          const finalStats = await fs.promises.stat(resolvedPath);
          
          this.logger?.debug(`File write successful: ${filePath}`, LogCategory.TOOLS, {
            contentLength: content.length,
            fileSize: finalStats.size
          });
        } finally {
          // Clean up temp directory
          await this.executeCommand(executionId, `rm -rf "${tempDir}"`).catch(() => {
            // Ignore cleanup errors
          });
        }
      }
    } catch (error) {
      throw new Error(`Failed to write file: ${(error as Error).message}`);
    }
  }

  async ls(executionId: string, dirPath: string, showHidden: boolean = false, details: boolean = false) {
    try {
      // Resolve the path
      const resolvedPath = path.resolve(dirPath);
      
      // Check if directory exists
      try {
        const stats = await fs.promises.stat(resolvedPath);
        if (!stats.isDirectory()) {
          return {
            ok: false as const,
            error: `Path exists but is not a directory: ${dirPath}`
          };
        }
      } catch {
        return {
          ok: false as const,
          error: `Directory does not exist: ${dirPath}`
        };
      }
      
      // Read directory contents
      this.logger?.debug(`Listing directory: ${resolvedPath}`, LogCategory.TOOLS);
      const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
      
      // Filter hidden files if needed
      const filteredEntries = showHidden ? 
        entries : 
        entries.filter(entry => !entry.name.startsWith('.'));
      
      // Format the results
      let results: FileEntry[];
      
      if (details) {
        // Get detailed information for all entries more efficiently
        // Instead of using Promise.all which creates many promises,
        // we'll use a more efficient approach with a single loop
        results = [];
        
        for (const entry of filteredEntries) {
          const entryPath = path.join(resolvedPath, entry.name);
          try {
            const stats = await fs.promises.stat(entryPath);
            results.push({
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 
                    entry.isFile() ? 'file' : 
                    entry.isSymbolicLink() ? 'symlink' : 'other',
              size: stats.size,
              modified: stats.mtime,
              created: stats.birthtime,
              isDirectory: entry.isDirectory(),
              isFile: entry.isFile(),
              isSymbolicLink: entry.isSymbolicLink()
            });
          } catch (err: unknown) {
            results.push({
              name: entry.name,
              isDirectory: false,
              isFile: false,
              isSymbolicLink: false,
              error: (err as Error).message
            });
          }
        }
      } else {
        // Simple listing
        results = filteredEntries.map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink()
        }));
      }
      
      return {
        ok: true as const,
        data: {
          path: resolvedPath,
          entries: results,
          count: results.length
        }
      };
    } catch (error: unknown) {
      this.logger?.error(`Error listing directory: ${(error as Error).message}`, error, LogCategory.TOOLS);
      return {
        ok: false as const,
        error: (error as Error).message
      };
    }
  }

  /**
   * Generates a structured directory map for the specified path
   * @param rootPath The root directory to map
   * @param maxDepth Maximum depth to traverse (default: 10)
   * @returns A formatted directory structure as a string
   */
  async generateDirectoryMap(rootPath: string, maxDepth: number = 10): Promise<string> {
    try {
      console.log(`LocalExecutionAdapter: Generating directory map for ${rootPath} with max depth ${maxDepth}`);
      
      // Use the shell script from our scripts directory
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'directory-mapper.sh');
      
      // Make sure the script exists and is executable
      try {
        await fs.promises.access(scriptPath, fs.constants.X_OK);
      } catch (error) {
        // If not executable, try to make it executable
        try {
          await fs.promises.chmod(scriptPath, 0o755);
        } catch (chmodError) {
          throw new Error(`Script exists but is not executable and could not be made executable: ${scriptPath}`);
        }
      }
      
      // Execute the script
      const { stdout, stderr, exitCode } = await this.executeCommand('local-directory-mapper', `"${scriptPath}" "${rootPath}" ${maxDepth}`);
      
      if (exitCode !== 0) {
        throw new Error(`Failed to generate directory structure: ${stderr}`);
      }
      
      return stdout;
    } catch (error) {
      console.error(`LocalExecutionAdapter: Error generating directory map: ${(error as Error).message}`);
      
      // Return a basic fallback structure on error
      return `<context name="directoryStructure">Below is a snapshot of this project's file structure at the start of the conversation. This snapshot will NOT update during the conversation. It skips over .gitignore patterns.

- ${rootPath}/
  - (Error mapping directory structure)
</context>`;
    }
  }
  
  /**
   * Retrieves git repository information for all repositories
   * @returns Array of git repository information (empty if no repositories)
   */
  async getGitRepositoryInfo(): Promise<GitRepositoryInfo[]> {
    try {
      // Get all repositories using the multi-repo manager
      const repos = await this.multiRepoManager.scanForRepos(this);
      
      if (repos.length === 0) {
        return [];
      }
      
      // Get git info for each repository
      const repoInfos = await Promise.all(
        repos.map(async (repoPath) => {
          try {
            return await this.gitInfoHelper.getGitRepositoryInfo(async (command) => {
              // Run git commands in the specific repository directory
              const fullCommand = `cd "${repoPath}" && ${command}`;
              const result = await this.executeCommand('local-git-info', fullCommand);
              return result;
            }, repoPath);
          } catch (error) {
            this.logger?.warn(`Error getting git info for ${repoPath}:`, error, LogCategory.SYSTEM);
            return null;
          }
        })
      );
      
      // Filter out any null results and return
      return repoInfos.filter((info): info is GitRepositoryInfo => info !== null);
    } catch (error) {
      this.logger?.error('Error retrieving git repository information:', error, LogCategory.SYSTEM);
      return [];
    }
  }
  
  /**
   * Retrieves directory structures for all repositories
   * @returns Map of repository root paths to their directory structure strings
   */
  async getDirectoryStructures(): Promise<Map<string, string>> {
    return this.multiRepoManager.getDirectoryStructures(this);
  }
}