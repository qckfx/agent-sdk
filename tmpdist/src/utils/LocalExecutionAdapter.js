import { exec } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import { glob } from 'glob';
import { LogCategory } from './logger.js';
import { AgentEvents, AgentEventType } from './sessionUtils.js';
import os from 'os';
import { GitInfoHelper } from './GitInfoHelper.js';
const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdtempAsync = promisify(fs.mkdtemp);
const mkdirAsync = promisify(fs.mkdir);
const globAsync = promisify(glob);
export class LocalExecutionAdapter {
    constructor(options) {
        this.logger = options?.logger;
        // Initialize git helper with same logger
        this.gitInfoHelper = new GitInfoHelper({ logger: this.logger });
        // Emit environment status as ready immediately for local adapter
        this.emitEnvironmentStatus('connected', true);
    }
    /**
     * Emit environment status event
     */
    emitEnvironmentStatus(status, isReady, error) {
        const statusEvent = {
            environmentType: 'local',
            status,
            isReady,
            error
        };
        this.logger?.info(`Emitting local environment status: ${status}, ready=${isReady}`, LogCategory.SYSTEM);
        AgentEvents.emit(AgentEventType.ENVIRONMENT_STATUS_CHANGED, statusEvent);
    }
    async executeCommand(executionId, command, workingDir) {
        try {
            const options = workingDir ? { cwd: workingDir } : undefined;
            const result = await execAsync(command, options);
            return {
                stdout: result.stdout.toString(),
                stderr: result.stderr.toString(),
                exitCode: 0
            };
        }
        catch (error) {
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
    async editFile(executionId, filepath, searchCode, replaceCode, encoding) {
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
                        success: false,
                        path: filepath,
                        error: `Path exists but is not a file: ${filepath}`
                    };
                }
                // Read file content for analysis
                fileContent = (await readFileAsync(resolvedPath, encoding)).toString();
            }
            catch (error) {
                const err = error;
                if (err.code === 'ENOENT') {
                    return {
                        success: false,
                        path: filepath,
                        error: `File does not exist: ${filepath}`
                    };
                }
                else {
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
                }
                catch (err) {
                    this.logger?.warn(`Binary-replace script not found or not executable at: ${binaryReplaceScript}`, LogCategory.TOOLS);
                    binaryReplaceExists = false;
                }
                let newContent;
                if (binaryReplaceExists) {
                    // Execute the binary-replace script to do the replacement
                    try {
                        const { exitCode, stdout, stderr } = await this.executeCommand(executionId, `"${binaryReplaceScript}" "${originalFile}" "${searchFile}" "${replaceFile}" "${newFile}"`);
                        if (exitCode !== 0) {
                            // Handle specific exit codes from the script
                            if (exitCode === 2) {
                                throw new Error(`Search pattern not found in file: ${filepath}`);
                            }
                            else if (exitCode === 3) {
                                throw new Error(`Multiple instances of the search pattern found in file: ${filepath}`);
                            }
                            else {
                                throw new Error(`Binary replacement script failed: ${stderr || stdout || 'Unknown error'}`);
                            }
                        }
                        // Read the new content after successful replacement
                        newContent = (await readFileAsync(newFile, encoding)).toString();
                    }
                    catch (scriptError) {
                        throw new Error(`Binary replacement failed: ${scriptError.message}`);
                    }
                }
                else {
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
                await writeFileAsync(resolvedPath, newContent, encoding);
                // Clean up temporary directory
                await this.executeCommand(executionId, `rm -rf "${tempDir}"`);
                return {
                    success: true,
                    path: resolvedPath,
                    originalContent: fileContent,
                    newContent: newContent
                };
            }
            catch (processingError) {
                // Clean up temporary directory on error
                await this.executeCommand(executionId, `rm -rf "${tempDir}"`).catch(() => {
                    // Ignore cleanup errors
                });
                throw processingError;
            }
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
    async glob(executionId, pattern, options = {}) {
        return globAsync(pattern, options);
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
        // Resolve the path (could add security checks here)
        const resolvedPath = path.resolve(filepath);
        // Check if file exists and get stats
        const stats = await fs.promises.stat(resolvedPath);
        if (!stats.isFile()) {
            return {
                success: false,
                path: filepath,
                error: `Path exists but is not a file: ${filepath}`
            };
        }
        // Check file size
        if (stats.size > maxSize) {
            return {
                success: false,
                path: filepath,
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
                    success: true,
                    path: resolvedPath,
                    content: base64Content,
                    size: data.length,
                    encoding: 'base64'
                };
            }
            catch (error) {
                return {
                    success: false,
                    path: filepath,
                    error: `Failed to read file in ${encoding} mode: ${error.message}`
                };
            }
        }
        // For text files, use standard text reading approach
        let content = '';
        if (lineOffset > 0 || lineCount !== undefined) {
            // Use head and tail with nl for pagination, starting line numbers from lineOffset+1
            const { stdout } = await execAsync(`head -n ${lineOffset + (lineCount || 0)} "${resolvedPath}" | tail -n ${lineCount || '+0'} | nl -v ${lineOffset + 1}`);
            content = stdout;
        }
        else {
            // Use nl for the whole file
            const { stdout } = await execAsync(`nl "${resolvedPath}"`);
            content = stdout;
        }
        // Handle line pagination if requested
        if (lineOffset > 0 || lineCount !== undefined) {
            const lines = content.split('\n');
            const startLine = Math.min(lineOffset, lines.length);
            const endLine = lineCount !== undefined
                ? Math.min(startLine + lineCount, lines.length)
                : lines.length;
            content = lines.slice(startLine, endLine).join('\n');
            return {
                success: true,
                path: resolvedPath,
                content,
                size: stats.size,
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
            path: resolvedPath,
            content,
            size: stats.size,
            encoding
        };
    }
    /**
     * Write content to a file
     * Uses a more robust approach for handling larger files
     */
    async writeFile(executionId, filePath, content, encoding) {
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
            }
            catch (err) {
                // Create directory if it doesn't exist
                await mkdirAsync(dirPath, { recursive: true });
            }
            // For smaller files, write directly
            if (content.length < 1048576) { // 1MB threshold
                await writeFileAsync(resolvedPath, content, encoding);
            }
            else {
                // For larger files, use a temporary file approach to avoid memory issues
                this.logger?.debug(`Using chunked approach for large file (${content.length} bytes): ${filePath}`, LogCategory.TOOLS);
                // Create a temporary file
                const tempDir = await mkdtempAsync(path.join(os.tmpdir(), 'qckfx-write-'));
                const tempFile = path.join(tempDir, 'temp_content');
                try {
                    // Write content to temp file
                    await writeFileAsync(tempFile, content, encoding);
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
                }
                finally {
                    // Clean up temp directory
                    await this.executeCommand(executionId, `rm -rf "${tempDir}"`).catch(() => {
                        // Ignore cleanup errors
                    });
                }
            }
        }
        catch (error) {
            throw new Error(`Failed to write file: ${error.message}`);
        }
    }
    async ls(executionId, dirPath, showHidden = false, details = false) {
        try {
            // Resolve the path
            const resolvedPath = path.resolve(dirPath);
            // Check if directory exists
            try {
                const stats = await fs.promises.stat(resolvedPath);
                if (!stats.isDirectory()) {
                    return {
                        success: false,
                        path: dirPath,
                        error: `Path exists but is not a directory: ${dirPath}`
                    };
                }
            }
            catch {
                return {
                    success: false,
                    path: dirPath,
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
            let results;
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
                    }
                    catch (err) {
                        results.push({
                            name: entry.name,
                            isDirectory: false,
                            isFile: false,
                            isSymbolicLink: false,
                            error: err.message
                        });
                    }
                }
            }
            else {
                // Simple listing
                results = filteredEntries.map(entry => ({
                    name: entry.name,
                    isDirectory: entry.isDirectory(),
                    isFile: entry.isFile(),
                    isSymbolicLink: entry.isSymbolicLink()
                }));
            }
            return {
                success: true,
                path: resolvedPath,
                entries: results,
                count: results.length
            };
        }
        catch (error) {
            this.logger?.error(`Error listing directory: ${error.message}`, error, LogCategory.TOOLS);
            return {
                success: false,
                path: dirPath,
                error: error.message
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
            console.log(`LocalExecutionAdapter: Generating directory map for ${rootPath} with max depth ${maxDepth}`);
            // Use the shell script from our scripts directory
            const scriptPath = path.resolve(process.cwd(), 'scripts', 'directory-mapper.sh');
            // Make sure the script exists and is executable
            try {
                await fs.promises.access(scriptPath, fs.constants.X_OK);
            }
            catch (error) {
                // If not executable, try to make it executable
                try {
                    await fs.promises.chmod(scriptPath, 0o755);
                }
                catch (chmodError) {
                    throw new Error(`Script exists but is not executable and could not be made executable: ${scriptPath}`);
                }
            }
            // Execute the script
            const { stdout, stderr, exitCode } = await this.executeCommand('local-directory-mapper', `"${scriptPath}" "${rootPath}" ${maxDepth}`);
            if (exitCode !== 0) {
                throw new Error(`Failed to generate directory structure: ${stderr}`);
            }
            return stdout;
        }
        catch (error) {
            console.error(`LocalExecutionAdapter: Error generating directory map: ${error.message}`);
            // Return a basic fallback structure on error
            return `<context name="directoryStructure">Below is a snapshot of this project's file structure at the start of the conversation. This snapshot will NOT update during the conversation. It skips over .gitignore patterns.

- ${rootPath}/
  - (Error mapping directory structure)
</context>`;
        }
    }
    /**
     * Retrieves git repository information for the current directory
     * Using the optimized GitInfoHelper for maximum performance
     * @returns Git repository information or null if not a git repository
     */
    async getGitRepositoryInfo() {
        try {
            // Use the dedicated GitInfoHelper for optimized, parallel git operations
            return await this.gitInfoHelper.getGitRepositoryInfo(async (command) => {
                // Pass our executeCommand implementation to the helper
                return await this.executeCommand('local-git-info', command);
            });
        }
        catch (error) {
            this.logger?.error('Error retrieving git repository information:', error, LogCategory.SYSTEM);
            return null;
        }
    }
}
//# sourceMappingURL=LocalExecutionAdapter.js.map