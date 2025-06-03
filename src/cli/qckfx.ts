#!/usr/bin/env node
/**
 * qckfx.ts – unified CLI entry-point for quick agent execution
 *
 * Usage examples:
 *   $ npx qckfx "What is the meaning of life?"
 *   $ npx qckfx -m gemini-2.5-pro "Summarise the repo"
 *   $ npx qckfx -a my-agent.json "List all TODOs in the codebase"
 *   $ npx qckfx --validate my-agent.json   # validate only
 */

import { readFileSync } from 'fs';
import path from 'path';

import { Command } from 'commander';
import prompts from 'prompts';
import ora from 'ora';

import { Agent } from '../Agent.js';

// Session persistence (CLI-only)
import { loadLastSession, saveSession } from './sessionStore.js';
import { ContextWindow } from '../types/contextWindow.js';

// Local schema validator (same helper used by validate-config.ts)
import { AgentConfigSchema } from '@qckfx/sdk-schema';
import { ZodError } from 'zod';

interface CliOptions {
  agent?: string;
  model?: string;
  apiKey?: string;
  url?: string;
  validate?: string;
  /** Commander stores this as a property literally named 'continue'.
   *  We use string-literal property name to avoid TS keyword issues. */
  'continue'?: boolean;
}

/** Build a minimal default AgentConfig that allows all built-in tools. */
function createDefaultConfig(model: string) {
  return {
    logLevel: 'error',
    defaultModel: model,
  } as const;
}

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
    .argument('[prompt...]', 'Prompt to run');

  program.parse(process.argv);

  const opts = program.opts<CliOptions>();
  const promptArgs: string[] = program.args as string[];

  // ---------------------------------------------------------
  // Session resume logic – load the previous context window
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Validation-only path
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Gather prompt (positional args or interactive)
  // ---------------------------------------------------------------------------
  let promptText: string | undefined;
  if (promptArgs && promptArgs.length > 0) {
    promptText = promptArgs.join(' ');
  } else {
    const res = await prompts({
      type: 'text',
      name: 'prompt',
      message: 'Enter prompt',
      validate: (val) => (val && val.trim().length > 0 ? true : 'Prompt cannot be empty'),
    });

    if (typeof res.prompt !== 'string') {
      console.error('Prompt is required.');
      process.exit(1);
    }
    promptText = res.prompt.trim();
  }

  // ---------------------------------------------------------------------------
  // Determine agent configuration
  // ---------------------------------------------------------------------------
  let agentConfig: any; // Using any to avoid re-declaring full type here

  if (opts.agent) {
    try {
      const filePath = path.resolve(process.cwd(), opts.agent);
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      // Validate upfront for a nicer error message
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

  // If the user supplied -m but the config already has defaultModel we still honour the flag when calling processQuery.

  // ---------------------------------------------------------------------------
  // Environment overrides
  // ---------------------------------------------------------------------------
  if (opts.apiKey) {
    process.env.LLM_API_KEY = opts.apiKey;
  }

  if (opts.url) {
    process.env.LLM_BASE_URL = opts.url;
  }

  // ---------------------------------------------------------------------------
  // Run the agent
  // ---------------------------------------------------------------------------
  const spinner = ora('Processing…').start();

  try {
    const agent = await Agent.create({ config: agentConfig });

    const modelToUse = opts.model ?? agentConfig.defaultModel ?? 'gemini-2.5-pro';

    const result = await agent.processQuery(
      promptText,
      modelToUse,
      initialContextWindow,
    );

    spinner.stop();

    if (result.aborted) {
      console.error('Operation aborted.');
      process.exit(1);
    }

    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    if (result.response) {
      console.log(result.response);
    } else {
      console.log('No response returned.');
    }

    // Persist the updated conversation for next time, ignoring failures.
    if (result.contextWindow) {
      saveSession(result.contextWindow as any);
    }

    process.exit(0);
  } catch (err) {
    spinner.stop();
    console.error((err as Error)?.message ?? err);
    process.exit(1);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
