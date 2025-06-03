import path from 'path';

import { Sandbox } from 'e2b';

import type { FileEditToolResult } from '../tools/FileEditTool.js';
import type { FileReadToolResult } from '../tools/FileReadTool.js';
import type { FileEntry, LSToolResult } from '../tools/LSTool.js';
import type { BusEvents} from '../types/bus-events.js';
import { BusEvent } from '../types/bus-events.js';
import type { GitRepositoryInfo } from '../types/repository.js';
import type { ExecutionAdapter } from '../types/tool.js';

import { GitInfoHelper } from './GitInfoHelper.js';
import type { Logger } from './logger.js';
import { LogCategory } from './logger.js';
import { MultiRepoManager } from './MultiRepoManager.js';
import type { EnvironmentStatusEvent } from './sessionUtils.js';
import type { TypedEventEmitter } from './TypedEventEmitter.js';

export class RemoteExecutionAdapter implements ExecutionAdapter {
  private sandbox: Sandbox;
  private sessionId: string;
  private logger?: Logger;

  // Git information helper for optimized git operations
  private gitInfoHelper: GitInfoHelper;

  // Root directory containing multiple git repos (for remote environments)
  private projectsRoot: string;

  // Multi-repo manager for handling multiple repositories
  private multiRepoManager: MultiRepoManager;

  private eventBus: TypedEventEmitter<BusEvents>;

  private constructor(
    sandbox: Sandbox,
    sessionId: string,
    options: {
      logger?: Logger;
      projectsRoot: string;
      eventBus: TypedEventEmitter<BusEvents>;
    },
  ) {
    this.sandbox = sandbox;
    this.sessionId = sessionId;
    this.logger = options?.logger;
    this.projectsRoot = options.projectsRoot;
    this.eventBus = options.eventBus;

    // Initialize git helper with same logger
    this.gitInfoHelper = new GitInfoHelper({ logger: this.logger });

    // Always initialize multi-repo manager
    this.multiRepoManager = new MultiRepoManager(this.projectsRoot);

    // Emit connected status since the sandbox is already connected at this point
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
      environmentType: 'remote',
      status,
      isReady,
      error,
    };

    this.logger?.info(
      `Emitting E2B environment status: ${status}, ready=${isReady}`,
      LogCategory.SYSTEM,
    );
    this.eventBus.emit(BusEvent.ENVIRONMENT_STATUS_CHANGED, {
      sessionId: this.sessionId,
      ...statusEvent,
    });
  }

  /**
   * Creates a new E2BExecutionAdapter instance with a connected sandbox
   * @param sandboxId The ID of the sandbox to connect to
   * @param options Optional configuration options
   * @param sessionId
   * @param options.logger
   * @param options.projectsRoot
   * @param options.eventBus
   * @returns A fully initialized E2BExecutionAdapter
   * @throws Error if connection to the sandbox fails
   */
  public static async create(
    sandboxId: string,
    sessionId: string,
    options: {
      logger?: Logger;
      projectsRoot: string;
      eventBus: TypedEventEmitter<BusEvents>;
    },
  ): Promise<RemoteExecutionAdapter> {
    try {
      // Emit initializing status before connecting
      options.logger?.info('E2B sandbox connecting...', LogCategory.SYSTEM);
      options.logger?.debug(
        'E2BExecutionAdapter: Connecting to sandbox',
        sandboxId,
        LogCategory.SYSTEM,
      );

      const initStatusEvent: EnvironmentStatusEvent = {
        environmentType: 'remote',
        status: 'connecting',
        isReady: false,
      };
      options.eventBus.emit(BusEvent.ENVIRONMENT_STATUS_CHANGED, {
        sessionId: sandboxId,
        ...initStatusEvent,
      });

      const sandbox = await Sandbox.connect(sandboxId);
      return new RemoteExecutionAdapter(sandbox, sessionId, options);
    } catch (error) {
      if (options?.logger) {
        options.logger.error('Failed to connect to E2B sandbox:', error, LogCategory.SYSTEM);
      } else {
        console.error('Failed to connect to E2B sandbox:', error);
      }

      // Emit error status from static context
      const errorStatusEvent: EnvironmentStatusEvent = {
        environmentType: 'remote',
        status: 'error',
        isReady: false,
        error: (error as Error).message,
      };
      options.eventBus.emit(BusEvent.ENVIRONMENT_STATUS_CHANGED, {
        sessionId: sessionId,
        ...errorStatusEvent,
      });

      throw error;
    }
  }

  async readFile(
    executionId: string,
    filepath: string,
    maxSize?: number,
    lineOffset?: number,
    lineCount?: number,
    encoding?: string,
  ): Promise<FileReadToolResult> {
    if (!encoding) {
      encoding = 'utf8';
    }
    if (!maxSize) {
      maxSize = 1048576;
    }
    if (!lineOffset) {
      lineOffset = 0;
    }
    if (!lineCount) {
      lineCount = undefined;
    }
    try {
      const exists = await this.sandbox.files.exists(filepath);
      if (!exists) {
        return {
          ok: false as const,
          error: `File does not exist: ${filepath}`,
        };
      }
      let fileContent = '';
      if (lineOffset > 0 || lineCount !== undefined) {
        // Use head and tail with nl for pagination, starting line numbers from lineOffset+1
        const { stdout } = await this.sandbox.commands.run(
          `head -n ${lineOffset + (lineCount || 0)} "${filepath}" | tail -n ${lineCount || '+0'} | nl -v ${lineOffset + 1}`,
        );
        fileContent = stdout;
      } else {
        // Use nl for the whole file
        const { stdout } = await this.sandbox.commands.run(`nl "${filepath}"`);
        fileContent = stdout;
      }

      // Handle line pagination if requested
      if (lineOffset > 0 || lineCount !== undefined) {
        const lines = fileContent.split('\n');
        const startLine = Math.min(lineOffset, lines.length);
        const endLine =
          lineCount !== undefined ? Math.min(startLine + lineCount, lines.length) : lines.length;

        fileContent = lines.slice(startLine, endLine).join('\n');

        return {
          ok: true as const,
          data: {
            path: filepath,
            content: fileContent,
            size: fileContent.length,
            encoding,
            pagination: {
              totalLines: lines.length,
              startLine,
              endLine,
              hasMore: endLine < lines.length,
            },
          },
        };
      }

      return {
        ok: true as const,
        data: {
          path: filepath,
          content: fileContent,
          size: fileContent.length,
          encoding,
        },
      };
    } catch (error: unknown) {
      const err = error as Error;
      throw new Error(`Failed to read file: ${err.message}`);
    }
  }

  async writeFile(executionId: string, filepath: string, content: string) {
    this.logger?.debug(`writeFile: ${filepath}`, LogCategory.TOOLS);
    const result = await this.sandbox.files.write(filepath, content);
    this.logger?.debug(`writeFile result: ${result}`, LogCategory.TOOLS);
    return;
  }

  async executeCommand(executionId: string, command: string, workingDir?: string) {
    return await this.sandbox.commands.run(command, { cwd: workingDir });
  }

  async glob(executionId: string, pattern: string, _options?: any): Promise<string[]> {
    try {
      // First try using the glob command if it exists
      const globCheck = await this.sandbox.commands.run('which glob || echo "not_found"');

      if (!globCheck.stdout.includes('not_found')) {
        // If glob command exists, use it
        const result = await this.sandbox.commands.run(`glob "${pattern}"`);
        return result.stdout
          .trim()
          .split('\n')
          .filter((line: string) => line.length > 0);
      } else {
        // Fall back to find command
        const result = await this.sandbox.commands.run(
          `find . -type f -path "${pattern}" -not -path "*/node_modules/*" -not -path "*/\\.*"`,
        );
        return result.stdout
          .trim()
          .split('\n')
          .filter((line: string) => line.length > 0);
      }
    } catch {
      // If any error occurs, fall back to the most basic implementation
      const result = await this.sandbox.commands.run(`ls -la ${pattern}`);
      return result.stdout
        .trim()
        .split('\n')
        .filter((line: string) => line.length > 0);
    }
  }

  async editFile(
    executionId: string,
    filepath: string,
    searchCode: string,
    replaceCode: string,
    encoding?: string,
  ): Promise<FileEditToolResult> {
    if (!encoding) {
      encoding = 'utf8';
    }
    try {
      const exists = await this.sandbox.files.exists(filepath);
      if (!exists) {
        return {
          ok: false as const,
          error: `File does not exist: ${filepath}`,
        };
      }
      const fileContent = await this.sandbox.files.read(filepath);

      // Normalize line endings to ensure consistent handling
      const normalizedContent = fileContent.replace(/\r\n/g, '\n');
      const normalizedSearchCode = searchCode.replace(/\r\n/g, '\n');
      const normalizedReplaceCode = replaceCode.replace(/\r\n/g, '\n');

      // Count occurrences of the search code in the normalized content
      const occurrences = normalizedContent.split(normalizedSearchCode).length - 1;

      if (occurrences === 0) {
        return {
          ok: false as const,
          error: `Search code not found in file: ${filepath}`,
        };
      }

      if (occurrences > 1) {
        return {
          ok: false as const,
          error: `Found ${occurrences} instances of the search code. Please provide a more specific search code that matches exactly once.`,
        };
      }

      // Use a more robust replacement approach
      // First, find the exact position of the search code
      const searchIndex = normalizedContent.indexOf(normalizedSearchCode);

      if (searchIndex === -1) {
        // This should not happen since we already checked occurrences
        return {
          ok: false as const,
          error: `Internal error: Search code not found despite occurrence check`,
        };
      }

      // Extract the parts before and after the search code
      const prefixContent = normalizedContent.substring(0, searchIndex);
      const suffixContent = normalizedContent.substring(searchIndex + normalizedSearchCode.length);

      // Construct the new content by joining the parts with the replacement in between
      const newContent = prefixContent + normalizedReplaceCode + suffixContent;

      // Add diagnostic logging for newline debugging
      this.logger?.debug('E2B file edit newline preservation check:', LogCategory.TOOLS, {
        searchEndsWithNewline: normalizedSearchCode.endsWith('\n'),
        replaceEndsWithNewline: normalizedReplaceCode.endsWith('\n'),
        suffixStartsWithNewline: suffixContent.startsWith('\n'),
      });

      await this.sandbox.files.write(filepath, newContent);
      return {
        ok: true as const,
        data: {
          path: filepath,
          originalContent: fileContent,
          newContent: newContent,
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

  async ls(
    executionId: string,
    dirPath: string,
    showHidden: boolean = false,
    details: boolean = false,
  ): Promise<LSToolResult> {
    try {
      const exists = await this.sandbox.files.exists(dirPath);
      if (!exists) {
        return {
          ok: false as const,
          error: `Directory does not exist: ${dirPath}`,
        };
      }

      // Read directory contents
      this.logger?.debug(`Listing directory: ${dirPath}`, LogCategory.TOOLS);
      const entries = await this.sandbox.files.list(dirPath);

      // Filter hidden files if needed
      const filteredEntries = showHidden
        ? entries
        : entries.filter((entry: any) => !entry.name.startsWith('.'));

      // Format the results
      let results: FileEntry[];

      if (details) {
        // Get detailed information for all entries in a single command
        // This is much more efficient than making individual stat calls
        const filePaths = filteredEntries.map((entry: any) => path.join(dirPath, entry.name));

        // Create a temporary script to get stats for all files at once
        const scriptContent = `
          for path in ${filePaths.map((p: string) => `"${p}"`).join(' ')}; do
            if [ -e "$path" ]; then
              stat -c "%n|%F|%s|%Y|%Z" "$path"
            fi
          done
        `;

        const { stdout } = await this.sandbox.commands.run(scriptContent);

        // Parse the output
        const statsMap = new Map<
          string,
          { type: string; size: number; mtime: number; ctime: number }
        >();

        stdout
          .trim()
          .split('\n')
          .forEach((line: string) => {
            const [name, type, size, mtime, ctime] = line.split('|');
            if (name && type) {
              statsMap.set(name, {
                type,
                size: parseInt(size, 10),
                mtime: parseInt(mtime, 10),
                ctime: parseInt(ctime, 10),
              });
            }
          });

        // Build results
        results = filteredEntries.map((entry: any) => {
          const stats = statsMap.get(entry.name);

          if (stats) {
            return {
              name: entry.name,
              type: stats.type,
              size: stats.size,
              modified: new Date(stats.mtime * 1000),
              created: new Date(stats.ctime * 1000),
              isDirectory: stats.type === 'directory',
              isFile: stats.type === 'regular file',
              isSymbolicLink: stats.type === 'symbolic link',
            };
          } else {
            // Fallback to basic info if stats not available
            return {
              name: entry.name,
              type: entry.type,
              isDirectory: entry.type === 'dir',
              isFile: entry.type === 'file',
              isSymbolicLink: false,
            };
          }
        });
      } else {
        // Simple listing
        results = filteredEntries.map((entry: any) => ({
          name: entry.name,
          type: entry.type,
          isDirectory: entry.type === 'dir',
          isFile: entry.type === 'file',
          isSymbolicLink: false, // E2B doesn't give a way to check
        }));
      }

      return {
        ok: true as const,
        data: {
          path: dirPath,
          entries: results,
          count: results.length,
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

  /**
   * Generates a structured directory map for the specified path
   * @param rootPath The root directory to map
   * @param maxDepth Maximum depth to traverse (default: 10)
   * @returns A formatted directory structure as a string
   */
  async generateDirectoryMap(rootPath: string, maxDepth: number = 10): Promise<string> {
    try {
      this.logger?.debug(
        `E2BExecutionAdapter: Generating directory map for ${rootPath} with max depth ${maxDepth}`,
        LogCategory.SYSTEM,
      );

      // Run the directory-mapper.sh script in the E2B environment
      const scriptPath = `/usr/local/bin/directory-mapper.sh`;
      const result = await this.sandbox.commands.run(`${scriptPath} "${rootPath}" ${maxDepth}`);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to generate directory structure: ${result.stderr}`);
      }

      return result.stdout;
    } catch (error) {
      console.error(
        `E2BExecutionAdapter: Error generating directory map: ${(error as Error).message}`,
      );

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
              const sandboxCommand = `cd "${repoPath}" && ${command}`;
              const result = await this.sandbox.commands.run(sandboxCommand);
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
      this.logger?.error(
        'Error retrieving git repository information from E2B sandbox:',
        error,
        LogCategory.SYSTEM,
      );
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
