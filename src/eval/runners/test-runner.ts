/**
 * Runs individual test cases for prompt evaluation
 */

import { createAgentRunner } from '../../core/AgentRunner.js';
import { createModelClient } from '../../core/ModelClient.js';
import { createToolRegistry } from '../../core/ToolRegistry.js';
import { createPermissionManager } from '../../core/PermissionManager.js';
import { LLMFactory } from '../../providers/index.js';
import { PromptManager } from '../../core/PromptManager.js';
import { LogLevel, createLogger } from '../../utils/logger.js';
import { TestCase, MetricsData, SystemPromptConfig, AgentExecutionHistory, TestRunWithHistory } from '../models/types.js';
import { ToolResultEntry } from '../../types/agent.js';
import { E2BExecutionAdapter } from '../../utils/E2BExecutionAdapter.js';
import { createBashTool } from '../../tools/BashTool.js';
import { createGlobTool } from '../../tools/GlobTool.js';
import { createGrepTool } from '../../tools/GrepTool.js';
import { createLSTool } from '../../tools/LSTool.js';
import { createFileReadTool } from '../../tools/FileReadTool.js';
import { createFileEditTool } from '../../tools/FileEditTool.js';
import { createFileWriteTool } from '../../tools/FileWriteTool.js';
import { extractExecutionHistory } from '../utils/execution-history.js';
import { ModelProvider } from '../../types/index.js';
import { ToolRegistry } from '../../types/registry.js';
import { createContextWindow } from '../../types/contextWindow.js';

/**
 * Run a single test case with the given system prompt
 * 
 * @param testCase The test case to run
 * @param systemPrompt The system prompt configuration to use
 * @param executionAdapter E2B execution adapter for sandbox execution
 * @returns Metrics data from the test run
 */
export async function runTestCase(
  testCase: TestCase,
  systemPrompt: SystemPromptConfig,
  executionAdapter: E2BExecutionAdapter
): Promise<MetricsData> {
  console.log(`Running test case: ${testCase.name} with prompt: ${systemPrompt.name}`);
  
  // Create a logger for this test run
  const logger = createLogger({ 
    level: LogLevel.INFO,
    prefix: `Test ${testCase.id}`
  });
  
  // Set context information for the test run
  logger.setContext({
    testId: testCase.id,
    testName: testCase.name,
    promptName: systemPrompt.name
  });
  
  // Set the base path for sandbox environment (for reference only)
  const _basePath = '/home/user';
  
  // Add debug logging about the execution adapter
  console.log('Debug - Execution adapter:', {
    type: typeof executionAdapter,
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(executionAdapter)),
    properties: Object.getOwnPropertyNames(executionAdapter)
  });
  
  // Initialize the provider with the specified system prompt
  const provider = LLMFactory.createProvider({
    model: systemPrompt.model || 'claude-3-7-sonnet-20250219',
    logger
  });
  
  const modelClient = createModelClient({
    modelProvider: provider
  });
  
  // Initialize the tool registry
  const toolRegistry = createToolRegistry();
  
  // Register default tools for the sandbox environment
  // This ensures we have tools available for Anthropic's tool_choice parameter
  const tools = [
    createBashTool(),
    createGlobTool(),
    createGrepTool(),
    createLSTool(),
    createFileReadTool(),
    createFileEditTool(),
    createFileWriteTool()
  ];
  
  tools.forEach(tool => toolRegistry.registerTool(tool));
  
  // Create the permission manager with DANGER_MODE enabled for sandbox execution
  const permissionManager = createPermissionManager(toolRegistry, {
    logger,
    DANGER_MODE: true
  });
  
  // Always enable DANGER_MODE for sandbox testing
  permissionManager.enableDangerMode();
  
  // Create the agent runner
  const runner = createAgentRunner({
    modelClient,
    toolRegistry,
    permissionManager,
    executionAdapter,
    logger
  });
  
  // Prepare metrics collection
  const startTime = Date.now();
  let toolCalls = 0;
  let success = false;
  let notes = '';
  const tokenUsage = {
    input: 0,
    output: 0,
    total: 0,
  };
  
  // Set up tool event listeners to count approved tool calls
  const startListener = toolRegistry.onToolExecutionStart(() => {
    toolCalls++;
    logger.info(`Tool call count increased to ${toolCalls}`);
  });
  
  // Also count completed tool calls in case any fail
  const completeListener = toolRegistry.onToolExecutionComplete((toolId) => {
    logger.info(`Tool ${toolId} executed successfully`);
  });
  
  // Also count error calls
  const errorListener = toolRegistry.onToolExecutionError((toolId, args, error) => {
    logger.error(`Tool ${toolId} failed with error: ${error.message}`);
  });
  
  try {
    // Run the test case
    const result = await runner.processQuery(testCase.instructions, systemPrompt.model || 'claude-3-7-sonnet-20250219', { contextWindow: createContextWindow() });
    
    // Determine success based on the result - no error means success by default
    success = !result.error;
    
    // Extract token usage from the session state if available
    if (result.sessionState && result.sessionState.tokenUsage) {
      const usageData = result.sessionState.tokenUsage as { totalTokens?: number };
      
      // The TokenManager stores this as totalTokens
      if (usageData.totalTokens) {
        tokenUsage.total = usageData.totalTokens;
        // Split the total roughly 33% input / 67% output as an estimate
        tokenUsage.input = Math.floor(tokenUsage.total * 0.33);
        tokenUsage.output = tokenUsage.total - tokenUsage.input;
      }
    }
    
    // Custom success criteria if provided
    if (testCase.successCriteria && result) {
      // Create a compatible TestRunWithHistory object
      const runWithHistory: TestRunWithHistory = {
        testCase,
        metrics: {
          testCase: testCase.name,
          promptName: '',
          duration: 0,
          toolCalls: result.result?.toolResults?.length || 0,
          tokenUsage: { input: 0, output: 0, total: 0 },
          success: false
        },
        executionHistory: {
          toolCalls: (result.result?.toolResults || []).map((tr: ToolResultEntry) => ({
            tool: tr.toolId || 'unknown',
            args: tr.args as Record<string, unknown> || {},
            result: String(tr.result || ''),
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }))
        }
      };
      
      success = testCase.successCriteria(runWithHistory);
    }
    
    // Custom notes if provided
    if (testCase.notes && result) {
      // Create a compatible TestRunWithHistory object if not already created
      const runWithHistory: TestRunWithHistory = {
        testCase,
        metrics: {
          testCase: testCase.name,
          promptName: '',
          duration: 0,
          toolCalls: result.result?.toolResults?.length || 0,
          tokenUsage: { input: 0, output: 0, total: 0 },
          success: false
        },
        executionHistory: {
          toolCalls: (result.result?.toolResults || []).map((tr: ToolResultEntry) => ({
            tool: tr.toolId || 'unknown',
            args: tr.args as Record<string, unknown> || {},
            result: String(tr.result || ''),
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }))
        }
      };
      
      notes = testCase.notes(runWithHistory);
    }
  } catch (error) {
    console.error(`Error running test case ${testCase.name}:`, error);
    success = false;
    notes = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    // Clean up the event listeners
    startListener();
    completeListener();
    errorListener();
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000; // Convert to seconds
  
  return {
    testCase: testCase.name,
    promptName: systemPrompt.name,
    duration,
    toolCalls,
    tokenUsage,
    success,
    notes,
  };
}

/**
 * Run a test case and collect execution history
 * 
 * @param testCase The test case to run
 * @param sandbox E2B sandbox instance for execution
 * @param modelProvider Model provider to use (typically Anthropic)
 * @param promptManager Prompt manager to use
 * @param toolRegistry Optional tool registry (will create a default if not provided)
 * @returns Test run results with metrics and execution history
 */
export async function runTestCaseWithHistory(
  testCase: TestCase,
  sandbox: E2BExecutionAdapter,
  modelProvider: ModelProvider,
  promptManager: PromptManager,
  toolRegistry?: ToolRegistry
): Promise<TestRunWithHistory> {
  console.log(`Running test case with history: ${testCase.name}`);
  
  // Create a logger for this test run
  const logger = createLogger({ 
    level: LogLevel.INFO,
    prefix: `Test ${testCase.id}`
  });
  
  // Set context information for the test run
  logger.setContext({
    testId: testCase.id,
    testName: testCase.name,
    modelName: 'unknown-model'
  });
  
  // Initialize the tool registry if not provided
  if (!toolRegistry) {
    toolRegistry = createToolRegistry();
    
    // Register default tools
    const tools = [
      createBashTool(),
      createGlobTool(),
      createGrepTool(),
      createLSTool(),
      createFileReadTool(),
      createFileEditTool(),
      createFileWriteTool()
    ];
    
    tools.forEach(tool => toolRegistry!.registerTool(tool));
  }
  
  // Create the permission manager with DANGER_MODE enabled
  const permissionManager = createPermissionManager(toolRegistry, {
    logger,
    DANGER_MODE: true
  });
  
  permissionManager.enableDangerMode();
  
  const modelClient = createModelClient({
    modelProvider,
    promptManager
  });
  
  // Create the agent runner
  const runner = createAgentRunner({
    modelClient,
    toolRegistry,
    permissionManager,
    executionAdapter: sandbox,
    logger
  });
  
  // Prepare metrics collection
  const startTime = Date.now();
  let toolCalls = 0;
  let success = false;
  let notes = '';
  const tokenUsage = {
    input: 0,
    output: 0,
    total: 0,
  };
  
  // Set up tool event listeners
  const startListener = toolRegistry.onToolExecutionStart(() => {
    toolCalls++;
    logger.info(`Tool call count increased to ${toolCalls}`);
  });
  
  const completeListener = toolRegistry.onToolExecutionComplete((toolId) => {
    logger.info(`Tool ${toolId} executed successfully`);
  });
  
  const errorListener = toolRegistry.onToolExecutionError((toolId, args, error) => {
    logger.error(`Tool ${toolId} failed with error: ${error.message}`);
  });
  
  try {
    // Create an empty session state to collect the conversation
    const sessionState = { contextWindow: createContextWindow() };
    
    // Run the test case with session state
    // Use a default model since PromptManager doesn't have getDefaultModel
    const result = await runner.processQuery(testCase.instructions, 'claude-3-7-sonnet-20250219', sessionState);
    
    // Record execution duration
    const duration = (Date.now() - startTime) / 1000;
    
    // Add duration to the result for extraction
    result.sessionState.duration = duration;
    
    // Determine success based on the result
    success = !result.error;
    
    // Extract token usage from the session state
    if (result.sessionState && result.sessionState.tokenUsage) {
      const usageData = result.sessionState.tokenUsage as { totalTokens?: number };
      
      if (usageData.totalTokens) {
        tokenUsage.total = usageData.totalTokens;
        tokenUsage.input = Math.floor(tokenUsage.total * 0.33);
        tokenUsage.output = tokenUsage.total - tokenUsage.input;
      }
    }
    
    // Custom success criteria if provided
    if (testCase.successCriteria && result) {
      // Create a compatible TestRunWithHistory object
      const runWithHistory: TestRunWithHistory = {
        testCase,
        metrics: {
          testCase: testCase.name,
          promptName: '',
          duration: 0,
          toolCalls: result.result?.toolResults?.length || 0,
          tokenUsage: { input: 0, output: 0, total: 0 },
          success: false
        },
        executionHistory: {
          toolCalls: (result.result?.toolResults || []).map((tr: ToolResultEntry) => ({
            tool: tr.toolId || 'unknown',
            args: tr.args as Record<string, unknown> || {},
            result: String(tr.result || ''),
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          })) || []
        }
      };
      
      success = testCase.successCriteria(runWithHistory);
    }
    
    // Custom notes if provided
    if (testCase.notes && result) {
      // Create a compatible TestRunWithHistory object if not already created
      const runWithHistory: TestRunWithHistory = {
        testCase,
        metrics: {
          testCase: testCase.name,
          promptName: '',
          duration: 0,
          toolCalls: result.result?.toolResults?.length || 0,
          tokenUsage: { input: 0, output: 0, total: 0 },
          success: false
        },
        executionHistory: {
          toolCalls: (result.result?.toolResults || []).map((tr: ToolResultEntry) => ({
            tool: tr.toolId || 'unknown',
            args: tr.args as Record<string, unknown> || {},
            result: String(tr.result || ''),
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          })) || []
        }
      };
      
      notes = testCase.notes(runWithHistory);
    }
    
    // Extract execution history with run and model information
    const executionHistory = extractExecutionHistory(
      result, 
      testCase.instructions,
      {
        runInfo: {
          testId: testCase.id,
          testName: testCase.name
        },
        configInfo: {
          promptName: testCase.name,
          modelName: 'unknown-model'
        }
      }
    );
    
    // Create metrics
    const metrics: MetricsData = {
      testCase: testCase.name,
      promptName: testCase.name,
      duration,
      toolCalls,
      tokenUsage,
      success,
      notes
    };
    
    return {
      testCase,
      metrics,
      executionHistory
    };
  } catch (error) {
    console.error(`Error running test case ${testCase.name}:`, error);
    
    // Create error metrics
    const duration = (Date.now() - startTime) / 1000;
    const metrics: MetricsData = {
      testCase: testCase.name,
      promptName: testCase.name,
      duration,
      toolCalls,
      tokenUsage,
      success: false,
      notes: `Error: ${error instanceof Error ? error.message : String(error)}`
    };
    
    // Create a minimal execution history for errors
    const executionHistory: AgentExecutionHistory = {
      metadata: {
        task: testCase.instructions
      },
      toolCalls: []
    };
    
    return {
      testCase,
      metrics,
      executionHistory
    };
  } finally {
    // Clean up the event listeners
    startListener();
    completeListener();
    errorListener();
  }
}