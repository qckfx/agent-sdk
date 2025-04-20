#!/usr/bin/env node
/**
 * Command Line Interface for the Agent Core
 */

import { program } from 'commander';
import { createAgent } from './public.js';
import { createAnthropicProvider } from './providers/AnthropicProvider.js';
import { createLogger, LogLevel, LogCategory } from './utils/logger.js';
import * as dotenv from 'dotenv';
import { SessionState, ToolResultEntry } from './types/index.js';
import chalk from 'chalk';
import prompts from 'prompts';
import setupEvalCLI from './eval/cli.js';
import { createContextWindow } from './types/contextWindow.js';

// Load environment variables from .env file
dotenv.config();

// Define a minimal spinner interface
interface Spinner {
  start: () => void;
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
}

/**
 * Formats a single tool call for display
 * @param toolResult - The tool result entry
 * @param index - The index of the tool result
 * @param logger - The logger instance
 */
function formatToolCall(
  toolResult: ToolResultEntry, 
  index: number, 
  logger: { 
    info: (message: string, category: LogCategory, ...args: unknown[]) => void 
  }
): void {
  // Get tool name
  const toolName = chalk.cyan(toolResult.toolId);
  
  // Format arguments in a more readable way
  let formattedArgs = '';
  
  // For file operations, highlight the file path
  if (toolResult.args.file_path || toolResult.args.filepath || toolResult.args.path) {
    const filePath = toolResult.args.file_path || toolResult.args.filepath || toolResult.args.path;
    
    // Show the file path with special formatting
    if (typeof filePath === 'string') {
      formattedArgs = chalk.yellow(filePath);
      
      // If there are other args, append them
      const otherArgs = { ...toolResult.args };
      delete otherArgs.file_path;
      delete otherArgs.filepath;
      delete otherArgs.path;
      
      if (Object.keys(otherArgs).length > 0) {
        const otherArgsStr = Object.entries(otherArgs)
          .map(([key, value]) => {
            // Truncate long string values
            if (typeof value === 'string' && value.length > 30) {
              return `${key}: "${value.substring(0, 30)}..."`;
            }
            return `${key}: ${JSON.stringify(value)}`;
          })
          .join(', ');
        
        if (otherArgsStr.length > 0) {
          formattedArgs += `, ${otherArgsStr}`;
        }
      }
    } else {
      // Fallback to standard formatting
      formattedArgs = formatArgs(toolResult.args);
    }
  } else {
    // Standard argument formatting
    formattedArgs = formatArgs(toolResult.args);
  }
  
  // Log the formatted tool call
  logger.info(`  ${index}. ${toolName}(${formattedArgs})`, LogCategory.TOOLS);
}

/**
 * Formats tool arguments in a more readable way
 * @param args - The tool arguments
 * @returns Formatted arguments string
 */
function formatArgs(args: Record<string, unknown>): string {
  // For simple objects, show key-value pairs with better formatting
  return Object.entries(args)
    .map(([key, value]) => {
      // Format based on type of value
      if (typeof value === 'string') {
        // Truncate long strings
        if (value.length > 50) {
          return `${key}: "${value.substring(0, 50)}..."`;
        }
        return `${key}: "${value}"`;
      } else if (value === null) {
        return `${key}: null`;
      } else if (Array.isArray(value)) {
        if (value.length > 3) {
          return `${key}: [${value.slice(0, 3).join(', ')}, ...]`;
        }
        return `${key}: [${value.join(', ')}]`;
      } else if (typeof value === 'object') {
        return `${key}: {...}`;
      }
      return `${key}: ${value}`;
    })
    .join(', ');
}

/**
 * Creates a summary of tool usage for display
 * @param toolResults - The list of tool results
 * @returns A summary string
 */
function summarizeToolUsage(toolResults: ToolResultEntry[]): string {
  // Count tools by type
  const toolCounts: Record<string, number> = {};
  
  toolResults.forEach(result => {
    const toolId = result.toolId;
    toolCounts[toolId] = (toolCounts[toolId] || 0) + 1;
  });
  
  // Create a summary string
  return Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1]) // Sort by most used
    .map(([tool, count]) => `${count}× ${tool}`)
    .join(', ');
}

// Chat command functionality, extracted to be reused in default command
const startChat = async (options: { 
  debug?: boolean, 
  model?: string, 
  quiet?: boolean,
  caching?: boolean
}) => {
  // Create a CLI logger first, so we can use it for errors
  const cliLogger = createLogger({ 
    level: options.quiet ? LogLevel.ERROR : (options.debug ? LogLevel.DEBUG : LogLevel.INFO),
    formatOptions: {
      showTimestamp: options.debug,
      showPrefix: true,
      colors: true
    }
  });
  
  // Set up graceful shutdown handling
  let isShuttingDown = false;
  const handleShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    cliLogger.info('Shutting down...', LogCategory.SYSTEM);
    process.exit(0);
  };

  // Handle termination signals
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    cliLogger.error('Uncaught exception:', error, LogCategory.SYSTEM);
    process.exit(1);
  });
  
  // Create the model provider
  const modelProvider = createAnthropicProvider({
    model: options.model,
    cachingEnabled: options.caching !== false // Enable caching by default
  });
  
  // We already created the logger above
  
  // Create the agent with default docker environment
  cliLogger.info(`Using docker execution environment by default`, LogCategory.SYSTEM);
  
  // Create the agent with a prompts-based permission handler
  const agent = createAgent({
    modelProvider,
    environment: { 
      type: 'docker'
    },
    logger: cliLogger,
    permissionUIHandler: {
      async requestPermission(toolId: string, args: Record<string, unknown>): Promise<boolean> {
        cliLogger.info(`Tool ${toolId} wants to execute with args:`, LogCategory.PERMISSIONS, args);
        
        // Use prompts for permission handling too
        const response = await prompts({
          type: 'confirm',
          name: 'granted',
          message: 'Do you approve this action?',
          initial: false
        });
        
        return response.granted === true;
      }
    }
  });
  
  // We'll keep track of the session state
  let conversationActive = true;
  let sessionState: SessionState = {
    contextWindow: createContextWindow(),
    abortController: new AbortController(),
    agentServiceConfig: {
      defaultModel: options.model,
      permissionMode: 'interactive',
      allowedTools: ['ReadTool', 'GlobTool', 'GrepTool', 'LSTool'],
      cachingEnabled: options.caching !== false // Enable caching by default
    }
  };
  cliLogger.info('Agent ready. Type your query (or "exit" to quit, "/help" for help):', LogCategory.USER_INTERACTION);
  
  while (conversationActive) {
    cliLogger.debug('--------- NEW TURN: Waiting for user input... ---------', LogCategory.USER_INTERACTION);
    
    // Use prompts for interactive input - onCancel is an option, not a prompt property
    const response = await prompts({
      type: 'text',
      name: 'query',
      message: chalk.blue('🧑'),
    }, {
      onCancel: () => {
        cliLogger.info('Cancelled by user', LogCategory.USER_INTERACTION);
        conversationActive = false;
        return false;
      }
    });
    
    // Check if we got a response
    if (!response.query) {
      if (conversationActive) {
        cliLogger.info('Empty input received, exiting...', LogCategory.USER_INTERACTION);
      }
      conversationActive = false;
      continue;
    }
    
    const query = response.query;
    cliLogger.debug(`Processing input: "${query}"`, LogCategory.USER_INTERACTION);
    
    // Handle special commands
    if (query.toLowerCase() === 'exit') {
      cliLogger.info('Exiting...', LogCategory.SYSTEM);
      conversationActive = false;
      continue;
    }
    
    if (query.toLowerCase() === '/help') {
      cliLogger.info('\n=== QCKFX Help ===', LogCategory.USER_INTERACTION);
      cliLogger.info('Available commands:', LogCategory.USER_INTERACTION);
      cliLogger.info('  exit - Exit the chat session', LogCategory.USER_INTERACTION);
      cliLogger.info('  /help - Show this help message', LogCategory.USER_INTERACTION);
      cliLogger.info('\nUsage:', LogCategory.USER_INTERACTION);
      cliLogger.info('  Just type your query and the agent will respond', LogCategory.USER_INTERACTION);
      cliLogger.info('  The agent can perform various tasks using tools', LogCategory.USER_INTERACTION);
      cliLogger.info('\nParameters:', LogCategory.USER_INTERACTION);
      cliLogger.info('  -d, --debug       Enable debug logging', LogCategory.USER_INTERACTION);
      cliLogger.info('  -q, --quiet       Minimal output, show only errors and results', LogCategory.USER_INTERACTION);
      cliLogger.info('  -m, --model       Specify the model to use', LogCategory.USER_INTERACTION);
      cliLogger.info('  --caching         Enable prompt caching for Claude (default: true)', LogCategory.USER_INTERACTION);
      cliLogger.info('  --no-caching      Disable prompt caching for Claude', LogCategory.USER_INTERACTION);
      cliLogger.info('\nEvaluation Commands:', LogCategory.USER_INTERACTION);
      cliLogger.info('  qckfx eval run    Run evaluation test cases', LogCategory.USER_INTERACTION);
      cliLogger.info('  qckfx eval list   List available test cases', LogCategory.USER_INTERACTION);
      cliLogger.info('  qckfx eval judge  Run AI judge on execution histories', LogCategory.USER_INTERACTION);
      cliLogger.info('  qckfx eval report Generate reports from evaluation results', LogCategory.USER_INTERACTION);
      cliLogger.info('\n', LogCategory.USER_INTERACTION);
      continue;
    }
    
    try {
      // Add user query to conversation history in the format expected by Claude
      sessionState.contextWindow.push({
        role: "user",
        content: [
          { type: "text", text: query, citations: null }
        ]
      });
      
      // Show spinner during processing
      let spinner: Spinner = { 
        start: () => {}, 
        succeed: () => {}, 
        fail: () => {} 
      };
      let result;
      
      try {
        // Dynamically import ora
        const ora = (await import('ora')).default;
        spinner = ora({
          text: 'Thinking...',
          color: 'blue',
        }).start();
        
        // Process the query
        result = await agent.processQuery(query, sessionState);
        spinner.succeed('Response ready');
      } catch (error) {
        // Make sure spinner is stopped on error
        spinner.fail('Processing failed');
        throw error;
      }
      
      if (result.error) {
        cliLogger.error(`Error: ${result.error}`, LogCategory.SYSTEM);
      } else {
        // Display prettier tool usage information without results
        if (!options.quiet && result.result && result.result.toolResults && result.result.toolResults.length > 0) {
          // Only show a summary initially if there are many tool calls
          const toolResults = result.result.toolResults;
          const totalTools = toolResults.length;
          
          if (totalTools > 5) {
            cliLogger.info(`\n🔧 ${totalTools} tools used (${summarizeToolUsage(toolResults)})`, LogCategory.TOOLS);
            
            // Show first and last tool call as a preview
            formatToolCall(toolResults[0], 1, cliLogger);
            cliLogger.info(`  ... ${totalTools - 2} more tools ...`, LogCategory.TOOLS);
            formatToolCall(toolResults[totalTools - 1], totalTools, cliLogger);
          } else {
            cliLogger.info('\n🔧 Tools Used:', LogCategory.TOOLS);
            toolResults.forEach((toolResult: ToolResultEntry, index: number) => {
              formatToolCall(toolResult, index + 1, cliLogger);
            });
          }
          
          cliLogger.info('', LogCategory.TOOLS); // Empty line for spacing
        }
        
        // Display the response to the user
        if (result.response) {
          // Add a visual marker for the assistant's response
          const assistantLabel = chalk.green('🤖 ');
          cliLogger.info(`${assistantLabel}${result.response}`, LogCategory.USER_INTERACTION);
          
          // Add the assistant's response to the conversation history
          sessionState.contextWindow.push({
            role: "assistant",
            content: [
              { type: "text", text: result.response, citations: null }
            ]
          });
          
          // Update the session state with other values from the result
          sessionState = {
            ...result.sessionState,
            agentServiceConfig: {
              defaultModel: options.model,
              permissionMode: 'interactive',
              allowedTools: ['ReadTool', 'GlobTool', 'GrepTool', 'LSTool'],
              cachingEnabled: options.caching !== false // Enable caching by default
            },
            contextWindow: sessionState.contextWindow, // Keep our updated conversation history
          };
        }
      }
    } catch (error) {
      cliLogger.error(`Error: ${error instanceof Error ? error.message : String(error)}`, error, LogCategory.SYSTEM);
    }
  }
  
  // Gracefully shut down
  await handleShutdown();
};

// Setup command line interface
program
  .name('qckfx')
  .description('AI Agent CLI with evaluation capabilities')
  .version('0.1.0')
  .addHelpText('after', `
Examples:
  # Start a chat session with the AI agent
  qckfx

  # Run evaluation with default settings
  qckfx eval run
  
  # List available test cases
  qckfx eval list
  
  # Run quick evaluation (subset of tests)
  qckfx eval run --quick
  
  # Generate a report from evaluation results
  qckfx eval report ./evaluation-results
  
Documentation:
  For more information, see the documentation or run 'qckfx <command> --help'
`);

// Chat command 
program
  .command('chat')
  .description('Start a conversation with the agent')
  .option('-d, --debug', 'Enable debug logging')
  .option('-q, --quiet', 'Minimal output, show only errors and results')
  .option('-m, --model <model>', 'Model to use', 'claude-3-7-sonnet-20250219')
  .option('--caching', 'Enable prompt caching for Claude (default: true)')
  .option('--no-caching', 'Disable prompt caching for Claude')
  .action(startChat);

// Default command (when no command is specified)
program
  .option('-d, --debug', 'Enable debug logging')
  .option('-q, --quiet', 'Minimal output, show only errors and results')
  .option('-m, --model <model>', 'Model to use', 'claude-3-7-sonnet-20250219')
  .option('--caching', 'Enable prompt caching for Claude (default: true)')
  .option('--no-caching', 'Disable prompt caching for Claude')
  .action(startChat);

// Setup evaluation commands
setupEvalCLI();

// Parse command line arguments
program.parse();

