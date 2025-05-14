import { Sandbox } from 'e2b';
import path from 'path';
import { LogCategory } from './logger.js';
import { AgentEvents, AgentEventType } from './sessionUtils.js';
import { GitInfoHelper } from './GitInfoHelper.js';
export class E2BExecutionAdapter {
    constructor(sandbox, options) {
        this.sandbox = sandbox;
        this.logger = options?.logger;
        // Initialize git helper with same logger
        this.gitInfoHelper = new GitInfoHelper({ logger: this.logger });
        // Emit connected status since the sandbox is already connected at this point
        this.emitEnvironmentStatus('connected', true);
    }
    /**
     * Emit environment status event
     */
    emitEnvironmentStatus(status, isReady, error) {
        const statusEvent = {
            environmentType: 'e2b',
            status,
            isReady,
            error
        };
        this.logger?.info(`Emitting E2B environment status: ${status}, ready=${isReady}`, LogCategory.SYSTEM);
        AgentEvents.emit(AgentEventType.ENVIRONMENT_STATUS_CHANGED, statusEvent);
    }
    /**
     * Creates a new E2BExecutionAdapter instance with a connected sandbox
     * @param sandboxId The ID of the sandbox to connect to
     * @param options Optional configuration options
     * @returns A fully initialized E2BExecutionAdapter
     * @throws Error if connection to the sandbox fails
     */
    static async create(sandboxId, options) {
        try {
            // Emit initializing status before connecting
            if (options?.logger) {
                options.logger.info('E2B sandbox connecting...', LogCategory.SYSTEM);
            }
            // Emit event from static context before instance is created
            const initStatusEvent = {
                environmentType: 'e2b',
                status: 'connecting',
                isReady: false
            };
            AgentEvents.emit(AgentEventType.ENVIRONMENT_STATUS_CHANGED, initStatusEvent);
            const sandbox = await Sandbox.connect(sandboxId);
            return new E2BExecutionAdapter(sandbox, options);
        }
        catch (error) {
            if (options?.logger) {
                options.logger.error('Failed to connect to E2B sandbox:', error, LogCategory.SYSTEM);
            }
            else {
                console.error('Failed to connect to E2B sandbox:', error);
            }
            // Emit error status from static context
            const errorStatusEvent = {
                environmentType: 'e2b',
                status: 'error',
                isReady: false,
                error: error.message
            };
            AgentEvents.emit(AgentEventType.ENVIRONMENT_STATUS_CHANGED, errorStatusEvent);
            throw error;
        }
    }
    async readFile(executionId, filepath, maxSize, lineOffset, lineCount, encoding) {
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
                    success: false,
                    path: filepath,
                    error: `File does not exist: ${filepath}`
                };
            }
            let fileContent = '';
            if (lineOffset > 0 || lineCount !== undefined) {
                // Use head and tail with nl for pagination, starting line numbers from lineOffset+1
                const { stdout } = await this.sandbox.commands.run(`head -n ${lineOffset + (lineCount || 0)} "${filepath}" | tail -n ${lineCount || '+0'} | nl -v ${lineOffset + 1}`);
                fileContent = stdout;
            }
            else {
                // Use nl for the whole file
                const { stdout } = await this.sandbox.commands.run(`nl "${filepath}"`);
                fileContent = stdout;
            }
            // Handle line pagination if requested
            if (lineOffset > 0 || lineCount !== undefined) {
                const lines = fileContent.split('\n');
                const startLine = Math.min(lineOffset, lines.length);
                const endLine = lineCount !== undefined
                    ? Math.min(startLine + lineCount, lines.length)
                    : lines.length;
                fileContent = lines.slice(startLine, endLine).join('\n');
                return {
                    success: true,
                    path: filepath,
                    content: fileContent,
                    size: fileContent.length,
                    encoding,
                    pagination: {
                        totalLines: lines.length,
                        startLine,
                        endLine,
                        hasMore: endLine < lines.length
                    }
                };
            }
            return {
                success: true,
                path: filepath,
                content: fileContent,
                size: fileContent.length,
                encoding
            };
        }
        catch (error) {
            const err = error;
            throw new Error(`Failed to read file: ${err.message}`);
        }
    }
    async writeFile(executionId, filepath, content) {
        await this.sandbox.files.write(filepath, content);
    }
    async executeCommand(executionId, command, workingDir) {
        return await this.sandbox.commands.run(command, { cwd: workingDir });
    }
    async glob(executionId, pattern, _options) {
        try {
            // First try using the glob command if it exists
            const globCheck = await this.sandbox.commands.run('which glob || echo "not_found"');
            if (!globCheck.stdout.includes('not_found')) {
                // If glob command exists, use it
                const result = await this.sandbox.commands.run(`glob "${pattern}"`);
                return result.stdout.trim().split('\n').filter((line) => line.length > 0);
            }
            else {
                // Fall back to find command
                const result = await this.sandbox.commands.run(`find . -type f -path "${pattern}" -not -path "*/node_modules/*" -not -path "*/\\.*"`);
                return result.stdout.trim().split('\n').filter((line) => line.length > 0);
            }
        }
        catch {
            // If any error occurs, fall back to the most basic implementation
            const result = await this.sandbox.commands.run(`ls -la ${pattern}`);
            return result.stdout.trim().split('\n').filter((line) => line.length > 0);
        }
    }
    async editFile(filepath, searchCode, replaceCode, encoding) {
        if (!encoding) {
            encoding = 'utf8';
        }
        try {
            const exists = await this.sandbox.files.exists(filepath);
            if (!exists) {
                return {
                    success: false,
                    path: filepath,
                    error: `File does not exist: ${filepath}`
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
                    success: false,
                    path: filepath,
                    error: `Search code not found in file: ${filepath}`
                };
            }
            if (occurrences > 1) {
                return {
                    success: false,
                    path: filepath,
                    error: `Found ${occurrences} instances of the search code. Please provide a more specific search code that matches exactly once.`
                };
            }
            // Use a more robust replacement approach
            // First, find the exact position of the search code
            const searchIndex = normalizedContent.indexOf(normalizedSearchCode);
            if (searchIndex === -1) {
                // This should not happen since we already checked occurrences
                return {
                    success: false,
                    path: filepath,
                    error: `Internal error: Search code not found despite occurrence check`
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
                suffixStartsWithNewline: suffixContent.startsWith('\n')
            });
            await this.sandbox.files.write(filepath, newContent);
            return {
                success: true,
                path: filepath,
                originalContent: fileContent,
                newContent: newContent
            };
        }
        catch (error) {
            const err = error;
            return {
                success: false,
                path: filepath,
                error: err.message
            };
        }
    }
    async ls(executionId, dirPath, showHidden = false, details = false) {
        try {
            const exists = await this.sandbox.files.exists(dirPath);
            if (!exists) {
                return {
                    success: false,
                    path: dirPath,
                    error: `Directory does not exist: ${dirPath}`
                };
            }
            // Read directory contents
            this.logger?.debug(`Listing directory: ${dirPath}`, LogCategory.TOOLS);
            const entries = await this.sandbox.files.list(dirPath);
            // Filter hidden files if needed
            const filteredEntries = showHidden ?
                entries :
                entries.filter((entry) => !entry.name.startsWith('.'));
            // Format the results
            let results;
            if (details) {
                // Get detailed information for all entries in a single command
                // This is much more efficient than making individual stat calls
                const filePaths = filteredEntries.map((entry) => path.join(dirPath, entry.name));
                // Create a temporary script to get stats for all files at once
                const scriptContent = `
          for path in ${filePaths.map((p) => `"${p}"`).join(' ')}; do
            if [ -e "$path" ]; then
              stat -c "%n|%F|%s|%Y|%Z" "$path"
            fi
          done
        `;
                const { stdout } = await this.sandbox.commands.run(scriptContent);
                // Parse the output
                const statsMap = new Map();
                stdout.trim().split('\n').forEach((line) => {
                    const [name, type, size, mtime, ctime] = line.split('|');
                    if (name && type) {
                        statsMap.set(name, {
                            type,
                            size: parseInt(size, 10),
                            mtime: parseInt(mtime, 10),
                            ctime: parseInt(ctime, 10)
                        });
                    }
                });
                // Build results
                results = filteredEntries.map((entry) => {
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
                            isSymbolicLink: stats.type === 'symbolic link'
                        };
                    }
                    else {
                        // Fallback to basic info if stats not available
                        return {
                            name: entry.name,
                            type: entry.type,
                            isDirectory: entry.type === 'dir',
                            isFile: entry.type === 'file',
                            isSymbolicLink: false
                        };
                    }
                });
            }
            else {
                // Simple listing
                results = filteredEntries.map((entry) => ({
                    name: entry.name,
                    type: entry.type,
                    isDirectory: entry.type === 'dir',
                    isFile: entry.type === 'file',
                    isSymbolicLink: false // E2B doesn't give a way to check
                }));
            }
            return {
                success: true,
                path: dirPath,
                entries: results,
                count: results.length
            };
        }
        catch (error) {
            const err = error;
            return {
                success: false,
                path: dirPath,
                error: err.message
            };
        }
    }
    /**
     * Generates a structured directory map for the specified path
     * @param rootPath The root directory to map
     * @param maxDepth Maximum depth to traverse (default: 10)
     * @returns A formatted directory structure as a string
     */
    async generateDirectoryMap(rootPath, maxDepth = 10) {
        try {
            console.log(`E2BExecutionAdapter: Generating directory map for ${rootPath} with max depth ${maxDepth}`);
            // Run the directory-mapper.sh script in the E2B environment
            const scriptPath = `/usr/local/bin/directory-mapper.sh`;
            const result = await this.sandbox.commands.run(`${scriptPath} "${rootPath}" ${maxDepth}`);
            if (result.exitCode !== 0) {
                throw new Error(`Failed to generate directory structure: ${result.stderr}`);
            }
            return result.stdout;
        }
        catch (error) {
            console.error(`E2BExecutionAdapter: Error generating directory map: ${error.message}`);
            // Return a basic fallback structure on error
            return `<context name="directoryStructure">Below is a snapshot of this project's file structure at the start of the conversation. This snapshot will NOT update during the conversation. It skips over .gitignore patterns.

- ${rootPath}/
  - (Error mapping directory structure)
</context>`;
        }
    }
    /**
     * Retrieves git repository information for the current directory in the E2B sandbox
     * Using the optimized GitInfoHelper for maximum performance
     * @returns Git repository information or null if not a git repository
     */
    async getGitRepositoryInfo() {
        try {
            // Get the default working directory in E2B (typically /home/user or similar)
            const workingDir = '/home/user';
            // Use the GitInfoHelper with a custom command executor that prepends cd workingDir
            return await this.gitInfoHelper.getGitRepositoryInfo(async (command) => {
                // Prepend cd to the working directory for all git commands
                const sandboxCommand = `cd "${workingDir}" && ${command}`;
                const result = await this.sandbox.commands.run(sandboxCommand);
                return result;
            });
        }
        catch (error) {
            this.logger?.error('Error retrieving git repository information from E2B sandbox:', error, LogCategory.SYSTEM);
            return null;
        }
    }
}
//# sourceMappingURL=E2BExecutionAdapter.js.map