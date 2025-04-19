/**
 * Tests for the PermissionManager with tool categories
 */
import { createPermissionManager } from '../PermissionManager.js';
import { createToolRegistry } from '../ToolRegistry.js';
import { ToolCategory } from '../../types/tool.js';
import { vi } from 'vitest';

describe('PermissionManager with Tool Categories', () => {
  test('should use tool categories for permission decisions', async () => {
    // Create a tool registry with test tools
    const toolRegistry = createToolRegistry();
    
    // Register sample tools
    toolRegistry.registerTool({
      id: 'bash',
      name: 'BashTool',
      description: 'Execute shell commands',
      requiresPermission: true,
      category: ToolCategory.SHELL_EXECUTION,
      alwaysRequirePermission: true,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    });
    
    toolRegistry.registerTool({
      id: 'file_edit',
      name: 'FileEditTool',
      description: 'Edit files',
      requiresPermission: true,
      category: ToolCategory.FILE_OPERATION,
      alwaysRequirePermission: false,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    });
    
    toolRegistry.registerTool({
      id: 'file_read',
      name: 'FileReadTool',
      description: 'Read files',
      requiresPermission: false,
      category: ToolCategory.READONLY,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    });
    
    // Create a mock UI handler
    const mockHandler = {
      requestPermission: vi.fn().mockResolvedValue(true),
    };
    
    // Create permission manager
    const permissionManager = createPermissionManager(toolRegistry, {
      uiHandler: mockHandler,
    });
    
    // Test shell tools always require permission
    expect(permissionManager.shouldRequirePermission('bash')).toBe(true);
    await permissionManager.requestPermission('bash', { command: 'ls' });
    expect(mockHandler.requestPermission).toHaveBeenCalledWith('bash', { command: 'ls' });
    
    // Test file operations initially require permission
    expect(permissionManager.shouldRequirePermission('file_edit')).toBe(true);
    await permissionManager.requestPermission('file_edit', { path: 'test.txt' });
    expect(mockHandler.requestPermission).toHaveBeenCalledWith('file_edit', { path: 'test.txt' });
    
    // Reset mock for next tests
    mockHandler.requestPermission.mockClear();
    
    // Test read-only tools don't require permission
    expect(permissionManager.shouldRequirePermission('file_read')).toBe(false);
    await permissionManager.requestPermission('file_read', { path: 'test.txt' });
    expect(mockHandler.requestPermission).not.toHaveBeenCalled();
  });
  
  test('should bypass permission for file operations in fast edit mode', async () => {
    // Create a tool registry with test tools
    const toolRegistry = createToolRegistry();
    
    // Register sample tools
    toolRegistry.registerTool({
      id: 'bash',
      name: 'BashTool',
      description: 'Execute shell commands',
      requiresPermission: true,
      category: ToolCategory.SHELL_EXECUTION,
      alwaysRequirePermission: true,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    });
    
    toolRegistry.registerTool({
      id: 'file_edit',
      name: 'FileEditTool',
      description: 'Edit files',
      requiresPermission: true,
      category: ToolCategory.FILE_OPERATION,
      alwaysRequirePermission: false,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    });
    
    // Create a mock UI handler
    const mockHandler = {
      requestPermission: vi.fn().mockResolvedValue(true),
    };
    
    // Create permission manager
    const permissionManager = createPermissionManager(toolRegistry, {
      uiHandler: mockHandler,
    });
    
    // Enable fast edit mode
    permissionManager.setFastEditMode(true);
    
    // File operations should not require permission in fast edit mode
    expect(permissionManager.shouldRequirePermission('file_edit')).toBe(false);
    await permissionManager.requestPermission('file_edit', { path: 'test.txt' });
    expect(mockHandler.requestPermission).not.toHaveBeenCalled();
    
    // Shell tools should still require permission
    expect(permissionManager.shouldRequirePermission('bash')).toBe(true);
    await permissionManager.requestPermission('bash', { command: 'ls' });
    expect(mockHandler.requestPermission).toHaveBeenCalledWith('bash', { command: 'ls' });
    
    // Disable fast edit mode
    permissionManager.setFastEditMode(false);
    
    // File operations should require permission again
    expect(permissionManager.shouldRequirePermission('file_edit')).toBe(true);
  });
  
  test('should handle tools without categories', async () => {
    // Create a tool registry with test tools
    const toolRegistry = createToolRegistry();
    
    // Register a tool without a category
    toolRegistry.registerTool({
      id: 'no_category',
      name: 'NoCategoryTool',
      description: 'A tool without a category',
      requiresPermission: true,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    });
    
    // Create a mock UI handler
    const mockHandler = {
      requestPermission: vi.fn().mockResolvedValue(true),
    };
    
    // Create permission manager
    const permissionManager = createPermissionManager(toolRegistry, {
      uiHandler: mockHandler,
    });
    
    // Enable fast edit mode
    permissionManager.setFastEditMode(true);
    
    // Tools without categories should still require permission
    expect(permissionManager.shouldRequirePermission('no_category')).toBe(true);
    await permissionManager.requestPermission('no_category', {});
    expect(mockHandler.requestPermission).toHaveBeenCalledWith('no_category', {});
  });
  
  test('should handle unknown tools', async () => {
    // Create an empty tool registry
    const toolRegistry = createToolRegistry();
    
    // Create a mock UI handler
    const mockHandler = {
      requestPermission: vi.fn().mockResolvedValue(true),
    };
    
    // Create permission manager
    const permissionManager = createPermissionManager(toolRegistry, {
      uiHandler: mockHandler,
    });
    
    // Unknown tools should require permission
    expect(permissionManager.shouldRequirePermission('unknown_tool')).toBe(true);
    await permissionManager.requestPermission('unknown_tool', {});
    expect(mockHandler.requestPermission).toHaveBeenCalledWith('unknown_tool', {});
  });
});