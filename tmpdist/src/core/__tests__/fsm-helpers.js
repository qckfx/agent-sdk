/**
 * Test helpers for the FSM driver tests
 */
import { LogLevel, LogCategory } from '../../utils/logger.js';
import { vi } from 'vitest';
/**
 * Creates a fake model client for testing
 */
export function fakeModelClient(opts) {
    let callCount = 0;
    return {
        formatToolsForClaude: () => [],
        async getToolCall(query, toolDescriptions, sessionState, options) {
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
            }
            else if (callCount === 2 && opts.secondChooseTool) {
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
                    content: [{ type: 'text', text: 'done' }]
                }
            };
        },
        async generateResponse(query, toolDescriptions, sessionState, options) {
            return {
                id: 'r2',
                role: 'assistant',
                content: [{ type: 'text', text: 'fallback' }]
            };
        },
    };
}
/**
 * Creates a stubbed tool registry for testing
 */
export function stubToolRegistry(abortBehavior) {
    const calls = [];
    // Create a fake registry
    const registry = {
        getToolDescriptions: () => [{
                id: 'grep',
                name: 'grep',
                description: 'grep tool for testing',
                parameters: {}
            }],
        getTool: () => ({
            id: 'grep',
            name: 'grep',
            description: 'grep tool for testing',
            requiresPermission: false,
            parameters: {},
            category: 'readonly'
        }),
        getAllTools: () => [],
        executeToolWithCallbacks: async (toolId, toolUseId, args, context) => {
            calls.push({ toolId, args });
            // Check for abort signal before proceeding
            if (context.abortSignal?.aborted) {
                throw new Error('AbortError');
            }
            if (abortBehavior === 'never-resolves') {
                // Return a promise that never resolves, used for testing abort during tool execution
                return new Promise((resolve) => {
                    // This promise deliberately never resolves
                });
            }
            return { ok: true };
        }
    };
    return { registry, calls };
}
/**
 * Creates a stub logger for testing
 */
export function stubLogger() {
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
            colors: false
        },
        enabledCategories: [
            LogCategory.SYSTEM,
            LogCategory.TOOLS,
            LogCategory.MODEL
        ]
    };
}
/**
 * Creates a stub permission manager for testing
 */
export function stubPermissionManager() {
    return {
        requestPermission: async () => true,
        setFastEditMode: () => { },
        isFastEditMode: () => false,
        shouldRequirePermission: () => false,
        enableDangerMode: () => { },
        disableDangerMode: () => { },
        isDangerModeEnabled: () => false
    };
}
/**
 * Creates a stub execution adapter for testing
 */
export function stubExecutionAdapter() {
    return {
        executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        editFile: async () => ({
            success: true,
            path: '/test/path',
            originalContent: 'original',
            newContent: 'modified'
        }),
        glob: async () => [],
        readFile: async () => ({
            success: true,
            path: '/test/path',
            content: '',
            size: 0,
            encoding: 'utf-8'
        }),
        writeFile: async () => { },
        ls: async () => ({
            success: true,
            path: '/test/path',
            entries: [],
            count: 0
        }),
        generateDirectoryMap: async () => '',
        getGitRepositoryInfo: async () => null
    };
}
//# sourceMappingURL=fsm-helpers.js.map