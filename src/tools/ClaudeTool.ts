/**
 * ClaudeTool - Executes local claude-code CLI queries
 */

import type { ToolResult } from '../types/tool-result.js';
import type { Tool, ToolContext, ValidationResult } from '../types/tool.js';
import { ToolCategory } from '../types/tool.js';

import { createTool } from './createTool.js';

export interface ClaudeToolArgs {
  /** Natural-language query forwarded to the claude CLI */
  query: string;
}

interface ClaudeToolData {
  stdout: string;
  stderr: string;
  /** the shell command that was executed */
  command: string;
}

export type ClaudeToolResult = ToolResult<ClaudeToolData>;

/**
 * Creates a tool for invoking the local `claude` coding CLI in headless mode.
 * @returns Claude tool
 */
export const createClaudeTool = (): Tool<ClaudeToolResult> => {
  return createTool({
    id: 'claude',
    name: 'ClaudeTool',
    description:
      `claude code is an agentic coding CLI tool. You are passing in the query to instruct the agent on what to do. ` +
      `The agent is fully autonomous and capable of writing and running code, running linters, tests, etc., ` +
      `reading code and browsing the codebase, answering questions about the code, refactoring code, and more.` +
      `This tool captures stdout/stderr. If the command fails (non-zero exit) or stderr contains 'rate limit', returns {error:"rate_limit"} so ` +
      `callers can gracefully fall back to other tools. Usage example:\n  { "query": "Refactor utils.ts for readability" }`,
    requiresPermission: true,
    alwaysRequirePermission: true,
    category: ToolCategory.SHELL_EXECUTION,

    parameters: {
      query: {
        type: 'string',
        description: 'Natural language prompt forwarded to the local claude CLI.',
      },
    },
    requiredParameters: ['query'],

    validateArgs: (args: Record<string, unknown>): ValidationResult => {
      if (typeof args.query !== 'string' || !args.query.trim()) {
        return { valid: false, reason: 'query must be a non-empty string' };
      }
      return { valid: true };
    },

    execute: async (
      args: Record<string, unknown>,
      context: ToolContext,
    ): Promise<ClaudeToolResult> => {
      const query = args.query as string;

      context.logger?.debug('ClaudeTool query:', query);
      // Create a temporary file *inside the execution environment* using the
      // adapter's writeFile capability so we don't depend on the local
      // filesystem layout.
      const tmpPath = `.claude_prompt_${Date.now()}_${Math.random().toString(36).substring(2)}.txt`;

      await context.executionAdapter.writeFile(context.executionId, tmpPath, query);

      const cmd = `claude -p --dangerously-skip-permissions < "${tmpPath}"`;

      try {
        context.logger?.debug(`Executing Claude CLI: ${cmd}`);
        const extendedTimeoutMs = 20 * 60 * 1000; // 20 minutes
        const { stdout, stderr, exitCode } = await context.executionAdapter.executeCommand(
          context.executionId,
          cmd,
          undefined, // workingDir
          false, // checkpoint (unused for local adapter)
          extendedTimeoutMs,
        );

        const isRateLimited = stderr.toLowerCase().includes('rate limit');

        context.logger?.debug('ClaudeTool stdout:', stdout);
        context.logger?.debug('ClaudeTool stderr:', stderr);

        if (exitCode !== 0 || isRateLimited) {
          return { ok: false, error: 'rate_limit' };
        }

        // truncate large outputs similar to BashTool
        const maxOutputSize = 100 * 1024;
        const trunc = (s: string) =>
          s.length > maxOutputSize
            ? s.slice(0, maxOutputSize) +
              `\n... (truncated, ${s.length - maxOutputSize} more bytes)`
            : s;

        return { ok: true, data: { stdout: trunc(stdout), stderr: trunc(stderr), command: cmd } };
      } catch (err) {
        context.logger?.error(`Claude CLI exec error: ${(err as Error).message}`);
        return { ok: false, error: 'rate_limit' };
      } finally {
        // Attempt to clean up the temporary prompt file. Use best-effort – we
        // don't fail the tool if cleanup doesn't work.
        try {
          await context.executionAdapter.executeCommand(context.executionId, `rm -f "${tmpPath}"`);
        } catch {
          /* ignore */
        }
      }
    },
  });
};
