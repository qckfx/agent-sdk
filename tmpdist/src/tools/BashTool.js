/**
 * BashTool - Executes shell commands in the environment
 */
import { createTool } from './createTool.js';
import { ToolCategory } from '../types/tool.js';
/**
 * Creates a tool for executing bash/shell commands
 * @returns The bash tool interface
 */
export const createBashTool = () => {
    return createTool({
        id: 'bash',
        name: 'BashTool',
        description: '- Executes shell commands in your environment\n- Maintains state between command executions\n- Supports all standard shell features and operations\n- Runs commands in specified working directories\n- Use this tool when you need to run terminal commands\n- For finding files or searching content, use GlobTool and GrepTool instead\n\nUsage notes:\n- Command output is returned as text, but is LIMITED TO 100KB PER STREAM (stdout/stderr)\n- Large outputs will be truncated with a message indicating how many bytes were omitted\n- For large outputs, use more specific commands or process outputs incrementally\n- File operations use the current working directory unless specified\n- Environment variables and shell state persist between commands\n- IMPORTANT: Prefer GlobTool over \'find\' and GrepTool over \'grep\' for more reliable results\n- IMPORTANT: Prefer FileReadTool over \'cat\', \'head\', \'tail\' for more reliable results',
        requiresPermission: true,
        category: ToolCategory.SHELL_EXECUTION,
        alwaysRequirePermission: true, // Shell execution always requires permission for security
        // Enhanced parameter descriptions
        parameters: {
            command: {
                type: "string",
                description: "The shell command to execute. Examples: 'ls -la', 'npm install', 'python script.py'"
            },
            workingDir: {
                type: "string",
                description: "Working directory for command execution. Use relative paths like 'src', '../', 'docs/v2' or absolute paths. Default: current directory"
            }
        },
        requiredParameters: ["command"],
        validateArgs: (args) => {
            if (typeof args === 'object' && args !== null) {
                if (!args.command || typeof args.command !== 'string') {
                    return {
                        valid: false,
                        reason: 'Command must be a string'
                    };
                }
                return { valid: true };
            }
            return {
                valid: false,
                reason: 'Invalid command format. Expected string or object with command property'
            };
        },
        execute: async (args, context) => {
            // Extract arguments
            const commandStr = args.command;
            const workingDir = args.workingDir;
            try {
                context.logger?.debug(`Executing bash command: ${commandStr}`);
                const executionAdapter = context.executionAdapter;
                const { stdout, stderr, exitCode } = await executionAdapter.executeCommand(context.executionId, commandStr, workingDir);
                // Truncate stdout/stderr to prevent context overflow (limit to ~100KB each)
                const maxOutputSize = 100 * 1024; // 100KB
                const truncatedStdout = stdout.length > maxOutputSize ?
                    stdout.substring(0, maxOutputSize) + `\n... (truncated, ${stdout.length - maxOutputSize} more bytes)` :
                    stdout;
                const truncatedStderr = stderr.length > maxOutputSize ?
                    stderr.substring(0, maxOutputSize) + `\n... (truncated, ${stderr.length - maxOutputSize} more bytes)` :
                    stderr;
                if (exitCode !== 0) {
                    return {
                        success: false,
                        error: truncatedStderr,
                        command: commandStr
                    };
                }
                return {
                    success: true,
                    stdout: truncatedStdout,
                    stderr: truncatedStderr,
                    command: commandStr
                };
            }
            catch (error) {
                const err = error;
                context.logger?.error(`Error executing bash command: ${err.message}`);
                return {
                    success: false,
                    error: err.message,
                    stderr: err.stderr,
                    stdout: err.stdout,
                    command: commandStr
                };
            }
        }
    });
};
//# sourceMappingURL=BashTool.js.map