#!/usr/bin/env node
/* eslint-disable jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns, @typescript-eslint/no-explicit-any */
/**
 * qckfx.ts – unified CLI entry-point for quick agent execution
 *
 * Usage examples:
 *   $ npx qckfx "What is the meaning of life?"
 *   $ npx qckfx -m gemini-2.5-pro "Summarise the repo"
 *   $ npx qckfx -a my-agent.json "List all TODOs in the codebase"
 *   $ npx qckfx --validate my-agent.json   # validate only
 */

/* eslint-disable no-console */

import { readFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import path from 'path';

import { AgentConfigSchema } from '@qckfx/sdk-schema';
import { Command } from 'commander';
import ora from 'ora';
import prompts from 'prompts';
import { ZodError } from 'zod';

import { Agent } from '../Agent.js';

// Session persistence helpers (CLI-only)
import { ContextWindow } from '../types/contextWindow.js';
import { LogLevel } from '../types/logger.js';
import { loadLastSession, saveSession } from './sessionStore.js';

// Shared helpers
import { augmentAgentConfigWithSubAgents } from './augmentSubAgentTools.js';
import { resolveAgentConfigPath } from './pathResolvers.js';
import { interactivePrompt } from './interactivePrompt.js';

//---------------------------------------------------------------------
// Types
//---------------------------------------------------------------------
interface CliOptions {
  agent?: string;
  model?: string;
  apiKey?: string;
  url?: string;
  validate?: string;
  /* Commander stores the flag literally named 'continue'.  We use an
   * index access to avoid the TS keyword when reading it below. */
  continue?: boolean;
  withSubagent?: string[];
  /** Suppress all output except final response or errors */
  quiet?: boolean;
}

//---------------------------------------------------------------------
// Helpers
//---------------------------------------------------------------------
/**
 * Read input from stdin asynchronously
 */
async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data.trim();
}

/**
 *
 * @param model
 */
function createDefaultConfig(model: string) {
  return {
    logLevel: 'error',
    defaultModel: model,
  } as const;
}

/**
 * Initialize .qckfx directory with default agent models
 */
function initCommand() {
  const targetDir = path.join(process.cwd(), '.qckfx');

  // Determine source path - works for both CommonJS and ESM builds
  // In the built dist, this file will be at dist/cjs/src/cli/qckfx.js, so we go up to repo root
  const sourceRoot = path.resolve(__dirname, '..', '..', '..', '..', '.qckfx');

  // Files to copy (excluding documentation-writer.json)
  const filesToCopy = [
    'advanced-agent.json',
    'agent-editor.json',
    'commit.json',
    'github-actions-architect.json',
    'sub-agents/browser.json',
    'sub-agents/coder.json',
  ];

  // Helper to copy a file and create necessary directories
  /**
   *
   * @param srcRelPath
   */
  function copyFile(srcRelPath: string) {
    const srcPath = path.join(sourceRoot, srcRelPath);
    const destPath = path.join(targetDir, srcRelPath);
    const destDir = path.dirname(destPath);

    // Create destination directory if it doesn't exist
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Copy the file
    copyFileSync(srcPath, destPath);
  }

  // Create .qckfx directory if it doesn't exist
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Copy all files
  const copiedFiles: string[] = [];
  for (const file of filesToCopy) {
    try {
      copyFile(file);
      copiedFiles.push(file);
    } catch (error) {
      console.error(`Failed to copy ${file}: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Display success message
  console.log('✅ qckfx initialization complete!');
  console.log('\nInstalled files:');
  for (const file of copiedFiles) {
    console.log(`  .qckfx/${file}`);
  }

  process.exit(0);
}

//---------------------------------------------------------------------
// Main
//---------------------------------------------------------------------
/**
 *
 */
async function main() {
  const program = new Command();

  program
    .name('qckfx')
    .description('Run qckfx agent or validate an agent definition file')
    .option('-a, --agent <file>', 'Agent definition JSON file')
    .option('-m, --model <model>', 'Model to use (default: gemini-2.5-pro)')
    .option('--api-key <key>', 'Override LLM_API_KEY environment variable')
    .option('--url <baseUrl>', 'Override LLM_BASE_URL environment variable')
    .option('-v, --validate <file>', 'Validate agent definition file and exit')
    .option('-c, --continue', 'Continue the most recent session')
    .option('-q, --quiet', 'Suppress all output except final response or errors')
    .option(
      '--with-subagent <name...>',
      'Add sub-agent tool(s) for this run (resolved from .qckfx/sub-agents/<name>.json)',
    )
    .argument('[prompt...]', 'Prompt to run')
    // NOTE: Commander treats the root command as a _command dispatcher_ when
    // sub-commands are declared (like our `init` command below).  Without an
    // action handler attached, any first positional argument is interpreted
    // as a potential sub-command, and an “unknown command” error is thrown if
    // it does not match one.  Adding a no-op action restores the expected
    // behaviour where arbitrary free-form text can be supplied as the prompt.
    //
    // We keep the existing parsing logic later in the file (using
    // `program.args`) so the remainder of the implementation remains
    // unchanged.
    .action(() => {
      /* noop – actual logic executed after program.parse */
    });

  // Add init subcommand
  program
    .command('init')
    .description(
      'Install default qckfx models into a new .qckfx directory in the current working directory',
    )
    .action(() => {
      initCommand();
    });

  program.parse(process.argv);

  const opts = program.opts<CliOptions>();
  const promptArgs: string[] = program.args as string[];

  // Override console methods when quiet flag is set
  if (opts.quiet) {
    const originalConsoleLog = console.log;

    console.log = () => {}; // Suppress all console.log calls
    console.warn = () => {}; // Suppress all console.warn calls

    // Restore original methods for final result output
    (global as any).__originalConsoleLog = originalConsoleLog;
  }

  //-------------------------------------------------------------------
  // Session resume logic
  //-------------------------------------------------------------------
  let initialContextWindow: ContextWindow | undefined;
  const continueFlag = (opts as Record<string, unknown>)['continue'] === true;

  if (continueFlag) {
    const loaded = loadLastSession();
    if (loaded?.messages) {
      try {
        initialContextWindow = new ContextWindow(loaded.messages as any);
      } catch {
        console.warn('⚠️  Failed to rebuild previous session; starting fresh.');
      }
    } else {
      console.warn('⚠️  No previous session found; starting a fresh one.');
    }
  }

  //-------------------------------------------------------------------
  // Validate-only path
  //-------------------------------------------------------------------
  if (opts.validate) {
    try {
      const filePath = path.resolve(process.cwd(), opts.validate);
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);

      AgentConfigSchema.parse(parsed);
      console.log('Configuration is valid ✅');
      process.exit(0);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        console.error('Configuration is invalid ❌');
        console.error(err.message);
        process.exit(1);
      }
      console.error((err as Error)?.message ?? err);
      process.exit(1);
    }
  }

  //-------------------------------------------------------------------
  // Gather prompt
  //-------------------------------------------------------------------
  let promptText = '';
  if (promptArgs && promptArgs.length > 0) {
    promptText = promptArgs.join(' ');
  } else {
    // Prefer stdin when quiet mode is requested, or when data is actually piped
    const attemptStdin = opts.quiet || !process.stdin.isTTY;
    if (attemptStdin) {
      promptText = await readStdin();
    }
  }

  // After reading from args or stdin, check if we still need a prompt
  if (!promptText) {
    if (opts.quiet) {
      console.error('Error: prompt required when using --quiet flag');
      process.exit(1);
    }

    promptText = await interactivePrompt(
      'Enter prompt (Enter to submit, \\ + Enter for newline, large pastes collapsed):',
    );

    if (!promptText) {
      console.error('Prompt is required.');
      process.exit(1);
    }
  }

  //-------------------------------------------------------------------
  // Determine agent configuration
  //-------------------------------------------------------------------
  let agentConfig: any; // Using `any` to avoid repeating full type here
  if (opts.agent) {
    try {
      const filePath = resolveAgentConfigPath(opts.agent);
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      AgentConfigSchema.parse(parsed);
      agentConfig = parsed;
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        console.error('Agent configuration invalid ❌');
        console.error(err.message);
        process.exit(1);
      }
      console.error((err as Error)?.message ?? err);
      process.exit(1);
    }
  } else {
    agentConfig = createDefaultConfig(opts.model ?? 'gemini-2.5-pro');
  }

  //-------------------------------------------------------------------
  // Environment overrides
  //-------------------------------------------------------------------
  if (opts.apiKey) {
    process.env.LLM_API_KEY = opts.apiKey;
  }
  if (opts.url) {
    process.env.LLM_BASE_URL = opts.url;
  }

  //-------------------------------------------------------------------
  // Augment config with additional sub-agent tool(s)
  //-------------------------------------------------------------------
  if (Array.isArray(opts.withSubagent) && opts.withSubagent.length > 0) {
    augmentAgentConfigWithSubAgents(agentConfig, opts.withSubagent, process.cwd());
  }

  //-------------------------------------------------------------------
  // Override log level for quiet mode
  //-------------------------------------------------------------------
  if (opts.quiet) {
    agentConfig.logLevel = LogLevel.ERROR;
  }

  //-------------------------------------------------------------------
  // Run the agent
  //-------------------------------------------------------------------
  const spinner = opts.quiet ? undefined : ora('Processing…').start();
  try {
    const agent = await Agent.create({ config: agentConfig });
    const modelToUse = opts.model ?? agentConfig.defaultModel ?? 'gemini-2.5-pro';

    const result = await agent.processQuery(promptText, modelToUse, initialContextWindow);
    if (spinner) spinner.stop();

    if (result.aborted) {
      console.error('Operation aborted.');
      process.exit(1);
    }
    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    if (result.response) {
      if (opts.quiet && (global as any).__originalConsoleLog) {
        (global as any).__originalConsoleLog(result.response);
      } else {
        console.log(result.response);
      }
    } else {
      if (opts.quiet && (global as any).__originalConsoleLog) {
        (global as any).__originalConsoleLog('No response returned.');
      } else {
        console.log('No response returned.');
      }
    }

    // Persist updated context for next session (ignore failures)
    if (result.contextWindow) {
      saveSession(result.contextWindow as any);
    }

    process.exit(0);
  } catch (err) {
    if (spinner) spinner.stop();
    console.error((err as Error)?.message ?? err);
    process.exit(1);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
