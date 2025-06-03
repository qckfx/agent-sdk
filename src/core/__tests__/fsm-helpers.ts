/**
 * Test helpers for the FSM driver tests
 */

import { vi } from 'vitest';

import type { FileEditToolResult } from '../../tools/FileEditTool.js';
import type { FileReadToolResult } from '../../tools/FileReadTool.js';
import type { LSToolResult } from '../../tools/LSTool.js';
import type { ModelClient } from '../../types/model.js';
import type { ToolRegistry } from '../../types/registry.js';
import type { ToolContext, ExecutionAdapter} from '../../types/tool.js';
import { ToolCategory } from '../../types/tool.js';
import type { Logger} from '../../utils/logger.js';
import { LogLevel, LogCategory } from '../../utils/logger.js';


/**
 * Creates a fake model client for testing
 * @param opts
 * @param opts.chooseTool
 * @param opts.secondChooseTool
 */
export function fakeModelClient(opts: {
  // when true model returns tool_use on first call, otherwise "none"
  chooseTool?: boolean;
  // optional second-model-call behaviour
  secondChooseTool?: boolean;
}): ModelClient {
  let callCount = 0;
  return {
    formatToolsForClaude: () => [],
    async getToolCall(
      query: string,
      toolDescriptions: any[],
      sessionState: any,
      options?: { signal?: AbortSignal; tool_choice?: any },
    ) {
      // Check if aborted
      if (options?.signal?.aborted) {
        throw new Error('AbortError');
      }

      callCount++;
      if (callCount === 1 && opts.chooseTool) {
        return {
          toolChosen: true,
          toolCall: { toolId: 'grep', toolUseId: 't1', args: { pattern: 'foo' } },
        };
      } else if (callCount === 2 && opts.secondChooseTool) {
        return {
          toolChosen: true,
          toolCall: { toolId: 'grep', toolUseId: 't2', args: { pattern: 'bar' } },
        };
      }

      return {
        toolChosen: false,
        response: {
          id: 'r1',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
        },
      };
    },
    async generateResponse(
      query: string,
      toolDescriptions: any[],
      sessionState: any,
      options?: { signal?: AbortSignal; tool_choice?: any },
    ) {
      return {
        id: 'r2',
        role: 'assistant',
        content: [{ type: 'text', text: 'fallback' }],
      };
    },
  } as unknown as ModelClient;
}

/**
 * Creates a stubbed tool registry for testing
 * @param abortBehavior
 */
export function stubToolRegistry(abortBehavior?: 'never-resolves'): {
  registry: ToolRegistry;
  calls: { toolId: string; args: Record<string, unknown> }[];
} {
  const calls: { toolId: string; args: Record<string, unknown> }[] = [];

  // Create a fake registry
  const registry = {
    getToolDescriptions: () => [
      {
        id: 'grep',
        name: 'grep',
        description: 'grep tool for testing',
        parameters: {},
      },
    ],
    getTool: () => ({
      id: 'grep',
      name: 'grep',
      description: 'grep tool for testing',
      requiresPermission: false,
      parameters: {},
      category: 'readonly',
    }),
    getAllTools: () => [],
    executeToolWithCallbacks: async (
      toolId: string,
      toolUseId: string,
      args: Record<string, unknown>,
      context: ToolContext,
    ) => {
      calls.push({ toolId, args });

      // Check for abort signal before proceeding
      if (context.abortSignal?.aborted) {
        throw new Error('AbortError');
      }

      if (abortBehavior === 'never-resolves') {
        // Return a promise that never resolves, used for testing abort during tool execution
        return new Promise(resolve => {
          // This promise deliberately never resolves
        });
      }

      return { ok: true };
    },
  } as unknown as ToolRegistry;

  return { registry, calls };
}

/**
 * Creates a stub logger for testing
 */
export function stubLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setContext: vi.fn(),
    level: LogLevel.DEBUG,
    prefix: 'TestLogger',
    silent: false,
    formatOptions: {
      showTimestamp: false,
      showPrefix: true,
      colors: false,
    },
    enabledCategories: [LogCategory.SYSTEM, LogCategory.TOOLS, LogCategory.MODEL],
  } as unknown as Logger;
}

/**
 * Creates a stub permission manager for testing
 */
export function stubPermissionManager() {
  return {
    requestPermission: async () => true,
    setFastEditMode: () => {},
    isFastEditMode: () => false,
    shouldRequirePermission: () => false,
    enableDangerMode: () => {},
    disableDangerMode: () => {},
    isDangerModeEnabled: () => false,
  };
}

/**
 * Creates a stub execution adapter for testing
 */
export function stubExecutionAdapter(): ExecutionAdapter {
  return {
    executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    editFile: async (): Promise<FileEditToolResult> => ({
      ok: true,
      data: {
        path: '/test/path',
        originalContent: 'original',
        newContent: 'modified',
      },
    }),
    glob: async () => [],
    readFile: async (): Promise<FileReadToolResult> => ({
      ok: true,
      data: {
        path: '/test/path',
        content: '',
        size: 0,
        encoding: 'utf-8',
      },
    }),
    writeFile: async () => {},
    ls: async (): Promise<LSToolResult> => ({
      ok: true,
      data: {
        path: '/test/path',
        entries: [],
        count: 0,
      },
    }),
    generateDirectoryMap: async () => '',
    getGitRepositoryInfo: async () => [],
    getDirectoryStructures: async () => new Map(),
  } as ExecutionAdapter;
}
