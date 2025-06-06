import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { glob } from 'glob';

import type { FileEntry } from '../tools/LSTool.js';
import { BusEvent } from '../types/bus-events.js';
import type { BusEvents } from '../types/bus-events.js';
import type { GitRepositoryInfo } from '../types/repository.js';
import type { ExecutionAdapter } from '../types/tool.js';

import { GitInfoHelper } from './GitInfoHelper.js';
import { LogCategory } from './logger.js';
import type { Logger } from './logger.js';
import { MultiRepoManager } from './MultiRepoManager.js';
import type { EnvironmentStatusEvent } from './sessionUtils.js';
import type { TypedEventEmitter } from './TypedEventEmitter.js';

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

  constructor(
    sessionId: string,
    options: {
      logger?: Logger;
      eventBus: TypedEventEmitter<BusEvents>;
    },
  ) {
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
   * @param status
   * @param isReady
   * @param error
   */
  private emitEnvironmentStatus(
    status: 'initializing' | 'connecting' | 'connected' | 'disconnected' | 'error',
    isReady: boolean,
    error?: string,
  ): void {
    const statusEvent: EnvironmentStatusEvent = {
      environmentType: 'local',
      status,
      isReady,
      error,
    };

    this.logger?.info(
      `Emitting local environment status: ${status}, ready=${isReady}`,
      LogCategory.SYSTEM,
    );
    this.eventBus.emit(BusEvent.ENVIRONMENT_STATUS_CHANGED, {
      sessionId: this.sessionId,
      ...statusEvent,
    });
  }
  async executeCommand(
    executionId: string,
    command: string,
    workingDir?: string,
    checkpoint?: boolean,
    timeoutMs: number = 5 * 60 * 1000, // 5-minute default to avoid runaway processes
    maxBuffer: number = 10 * 1024 * 1024, // 10 MB of stdout/stderr capture
  ) {
    try {
      const execOptions: any = {
        timeout: timeoutMs,
        maxBuffer,
      };
      if (workingDir) {
        execOptions.cwd = workingDir;
      }

      const result = await execAsync(command, execOptions);
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: 0,
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        return {
          stdout: '',
          stderr: error.message,
          exitCode: 1,
        };
      }
      return {
        stdout: '',
        stderr: 'Unknown error',
        exitCode: 1,
      };
    }
  }

  /**
   * Edit a file by replacing content
   * Uses a binary-safe approach to handle files with special characters and line endings
   * @param executionId
   * @param filepath
   * @param searchCode
   * @param replaceCode
   * @param encoding
   */
  async editFile(
    executionId: string,
    filepath: string,
    searchCode: string,
    replaceCode: string,
    encoding?: string,
  ) {
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
            error: `Path exists but is not a file: ${filepath}`,
          };
        }

        // Read file content for analysis
        fileContent = (await readFileAsync(resolvedPath, encoding as BufferEncoding)).toString();
      } catch (error: unknown) {
        const err = error as Error & { code?: string };
        if (err.code === 'ENOENT') {
          return {
            ok: false as const,
            error: `File does not exist: ${filepath}`,
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
          error: `Search code not found in file: ${filepath}. Ensure the search code matches exactly, including whitespace and line endings. Consider reading the file first to verify the exact content.`,
        };
      }

      if (occurrences > 1) {
        return {
          ok: false as const,
          error: `Found ${occurrences} instances of the search code in ${filepath}. Please provide a more specific search code with additional surrounding context to ensure exactly one match.`,
        };
      }

      // ---------------------------------------------
      // In-memory binary-safe replacement (single match)
      // ---------------------------------------------

      // Read original file as raw bytes
      const originalBuffer = await fs.promises.readFile(resolvedPath);

      // Build candidate search buffers to handle possible \r\n vs \n differences
      const searchBufferCandidates = [
        Buffer.from(searchCode, encoding as BufferEncoding),
        Buffer.from(normalizedSearchCode, encoding as BufferEncoding),
      ];

      let firstIdx = -1;
      let searchBuffer: Buffer | null = null;
      for (const cand of searchBufferCandidates) {
        if (cand.length === 0) continue;
        const idx = originalBuffer.indexOf(cand);
        if (idx !== -1) {
          firstIdx = idx;
          searchBuffer = cand;
          break;
        }
      }

      if (firstIdx === -1 || !searchBuffer) {
        return {
          ok: false as const,
          error: `Search code not found in file: ${filepath}. Ensure the search code matches exactly, including whitespace and line endings. Consider reading the file first to verify the exact content.`,
        };
      }

      const secondIdx = originalBuffer.indexOf(searchBuffer, firstIdx + searchBuffer.length);
      if (secondIdx !== -1) {
        return {
          ok: false as const,
          error: `Found multiple instances of the search code in ${filepath}. Please provide a more specific search code with additional surrounding context to ensure exactly one match.`,
        };
      }

      // Build new buffer
      const replaceBuffer = Buffer.from(replaceCode, encoding as BufferEncoding);

      const newBuffer = Buffer.concat([
        originalBuffer.subarray(0, firstIdx),
        replaceBuffer,
        originalBuffer.subarray(firstIdx + searchBuffer.length),
      ]);

      // Write back atomically using a temporary file then rename
      const tempDir = await mkdtempAsync(path.join(os.tmpdir(), 'qckfx-edit-'));
      const tempFilePath = path.join(tempDir, path.basename(resolvedPath));
      await fs.promises.writeFile(tempFilePath, newBuffer);
      await fs.promises.rename(tempFilePath, resolvedPath);
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {
        /* ignore */
      });

      const newContent = newBuffer.toString(encoding as BufferEncoding);

      return {
        ok: true as const,
        data: {
          path: resolvedPath,
          originalContent: fileContent,
          newContent,
        },
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        ok: false as const,
        error: err.message,
      };
    }
  }

  async glob(executionId: string, pattern: string, options: any = {}): Promise<string[]> {
    return glob(pattern, options) as Promise<string[]>;
  }

  async readFile(
    executionId: string,
    filepath: string,
    maxSize?: number,
    lineOffset?: number,
    lineCount?: number,
    encoding?: string,
    numberLines: boolean = true,
  ) {
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
        error: `Path exists but is not a file: ${filepath}`,
      };
    }

    // Check file size
    if (stats.size > maxSize) {
      return {
        ok: false as const,
        error: `File is too large (${stats.size} bytes) to read. Max size: ${maxSize} bytes`,
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
            encoding: 'base64',
          },
        };
      } catch (error) {
        return {
          ok: false as const,
          error: `Failed to read file in ${encoding} mode: ${(error as Error).message}`,
        };
      }
    }

    // Read the entire file – we have already checked that it does
    // not exceed `maxSize`.
    const rawText = await fs.promises.readFile(resolvedPath, encoding as BufferEncoding);

    // Split into lines (preserve empty trailing line if present)
    const allLines = rawText.split(/\r?\n/);

    // Determine slice bounds
    const startIdx = Math.max(0, lineOffset);
    const endIdx =
      lineCount !== undefined ? Math.min(startIdx + lineCount, allLines.length) : allLines.length;

    const requestedLines = allLines.slice(startIdx, endIdx);

    let content: string;
    if (numberLines) {
      // Prefix each line with its (1-based) number using a tab – the
      // same format that the `nl` utility would produce.
      const numbered = requestedLines.map(
        (ln, i) => `${(startIdx + i + 1).toString().padStart(6, ' ')}\t${ln}`,
      );
      content = numbered.join('\n');
    } else {
      content = requestedLines.join('\n');
    }

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
          hasMore: endIdx < allLines.length,
        },
      },
    };
  }

  /**
   * Write content to a file
   * Uses a more robust approach for handling larger files
   * @param executionId
   * @param filePath
   * @param content
   * @param encoding
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
      if (content.length < 1048576) {
        // 1MB threshold
        await writeFileAsync(resolvedPath, content, encoding as BufferEncoding);
      } else {
        // For larger files, use a temporary file approach to avoid memory issues
        this.logger?.debug(
          `Using chunked approach for large file (${content.length} bytes): ${filePath}`,
          LogCategory.TOOLS,
        );

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
            fileSize: finalStats.size,
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

  async ls(
    executionId: string,
    dirPath: string,
    showHidden: boolean = false,
    details: boolean = false,
  ) {
    try {
      // Resolve the path
      const resolvedPath = path.resolve(dirPath);

      // Check if directory exists
      try {
        const stats = await fs.promises.stat(resolvedPath);
        if (!stats.isDirectory()) {
          return {
            ok: false as const,
            error: `Path exists but is not a directory: ${dirPath}`,
          };
        }
      } catch {
        return {
          ok: false as const,
          error: `Directory does not exist: ${dirPath}`,
        };
      }

      // Read directory contents
      this.logger?.debug(`Listing directory: ${resolvedPath}`, LogCategory.TOOLS);
      const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });

      // Filter hidden files if needed
      const filteredEntries = showHidden
        ? entries
        : entries.filter(entry => !entry.name.startsWith('.'));

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
              type: entry.isDirectory()
                ? 'directory'
                : entry.isFile()
                  ? 'file'
                  : entry.isSymbolicLink()
                    ? 'symlink'
                    : 'other',
              size: stats.size,
              modified: stats.mtime,
              created: stats.birthtime,
              isDirectory: entry.isDirectory(),
              isFile: entry.isFile(),
              isSymbolicLink: entry.isSymbolicLink(),
            });
          } catch (err: unknown) {
            results.push({
              name: entry.name,
              isDirectory: false,
              isFile: false,
              isSymbolicLink: false,
              error: (err as Error).message,
            });
          }
        }
      } else {
        // Simple listing
        results = filteredEntries.map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink(),
        }));
      }

      return {
        ok: true as const,
        data: {
          path: resolvedPath,
          entries: results,
          count: results.length,
        },
      };
    } catch (error: unknown) {
      this.logger?.error(
        `Error listing directory: ${(error as Error).message}`,
        error,
        LogCategory.TOOLS,
      );
      return {
        ok: false as const,
        error: (error as Error).message,
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
      this.logger?.debug(
        `Generating directory map for ${rootPath} with max depth ${maxDepth}`,
        LogCategory.SYSTEM,
      );

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
          throw new Error(
            `Script exists but is not executable and could not be made executable: ${scriptPath}`,
          );
        }
      }

      // Execute the script
      const { stdout, stderr, exitCode } = await this.executeCommand(
        'local-directory-mapper',
        `"${scriptPath}" "${rootPath}" ${maxDepth}`,
      );

      if (exitCode !== 0) {
        throw new Error(`Failed to generate directory structure: ${stderr}`);
      }

      return stdout;
    } catch (error) {
      this.logger?.error('Error generating directory map', error as Error, LogCategory.SYSTEM);

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
        repos.map(async repoPath => {
          try {
            return await this.gitInfoHelper.getGitRepositoryInfo(async command => {
              // Run git commands in the specific repository directory
              const fullCommand = `cd "${repoPath}" && ${command}`;
              const result = await this.executeCommand('local-git-info', fullCommand);
              return result;
            }, repoPath);
          } catch (error) {
            this.logger?.warn(`Error getting git info for ${repoPath}:`, error, LogCategory.SYSTEM);
            return null;
          }
        }),
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
