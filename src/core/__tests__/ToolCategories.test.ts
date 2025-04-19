/**
 * Unit tests for tool categories
 */
import { createToolRegistry } from '../ToolRegistry.js';
import { Tool, ToolCategory } from '../../types/tool.js';
import { vi } from 'vitest';

describe('Tool Categories', () => {
  test('should register tools with categories', () => {
    const registry = createToolRegistry();
    
    // Create mock tools with different categories
    const bashTool: Tool = {
      id: 'bash',
      name: 'BashTool',
      description: 'Execute shell commands',
      requiresPermission: true,
      category: ToolCategory.SHELL_EXECUTION,
      alwaysRequirePermission: true,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    };
    
    const fileEditTool: Tool = {
      id: 'file_edit',
      name: 'FileEditTool',
      description: 'Edit files',
      requiresPermission: true,
      category: ToolCategory.FILE_OPERATION,
      alwaysRequirePermission: false,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    };
    
    const readTool: Tool = {
      id: 'file_read',
      name: 'FileReadTool',
      description: 'Read files',
      requiresPermission: false,
      category: ToolCategory.READONLY,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    };
    
    // Register the tools
    registry.registerTool(bashTool);
    registry.registerTool(fileEditTool);
    registry.registerTool(readTool);
    
    // Test getToolsByCategory
    const shellTools = registry.getToolsByCategory(ToolCategory.SHELL_EXECUTION);
    expect(shellTools).toHaveLength(1);
    expect(shellTools[0].id).toBe('bash');
    
    const fileTools = registry.getToolsByCategory(ToolCategory.FILE_OPERATION);
    expect(fileTools).toHaveLength(1);
    expect(fileTools[0].id).toBe('file_edit');
    
    const readTools = registry.getToolsByCategory(ToolCategory.READONLY);
    expect(readTools).toHaveLength(1);
    expect(readTools[0].id).toBe('file_read');
    
    // Test isToolInCategory
    expect(registry.isToolInCategory('bash', ToolCategory.SHELL_EXECUTION)).toBe(true);
    expect(registry.isToolInCategory('bash', ToolCategory.FILE_OPERATION)).toBe(false);
    
    expect(registry.isToolInCategory('file_edit', ToolCategory.FILE_OPERATION)).toBe(true);
    expect(registry.isToolInCategory('file_edit', ToolCategory.SHELL_EXECUTION)).toBe(false);
    
    expect(registry.isToolInCategory('file_read', ToolCategory.READONLY)).toBe(true);
    expect(registry.isToolInCategory('file_read', ToolCategory.FILE_OPERATION)).toBe(false);
  });
  
  test('should handle tools with multiple categories', () => {
    const registry = createToolRegistry();
    
    // Create a tool with multiple categories
    const multiCategoryTool: Tool = {
      id: 'multi_tool',
      name: 'MultiCategoryTool',
      description: 'Tool with multiple categories',
      requiresPermission: true,
      category: [ToolCategory.FILE_OPERATION, ToolCategory.NETWORK],
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    };
    
    registry.registerTool(multiCategoryTool);
    
    // Tool should appear in both categories
    expect(registry.getToolsByCategory(ToolCategory.FILE_OPERATION)).toHaveLength(1);
    expect(registry.getToolsByCategory(ToolCategory.NETWORK)).toHaveLength(1);
    
    // Tool should match both categories
    expect(registry.isToolInCategory('multi_tool', ToolCategory.FILE_OPERATION)).toBe(true);
    expect(registry.isToolInCategory('multi_tool', ToolCategory.NETWORK)).toBe(true);
    expect(registry.isToolInCategory('multi_tool', ToolCategory.SHELL_EXECUTION)).toBe(false);
  });
  
  test('should include category information in tool descriptions', () => {
    const registry = createToolRegistry();
    
    // Register a tool with category
    registry.registerTool({
      id: 'test_tool',
      name: 'TestTool',
      description: 'Test tool',
      requiresPermission: true,
      category: ToolCategory.FILE_OPERATION,
      alwaysRequirePermission: false,
      parameters: {},
      requiredParameters: [],
      execute: vi.fn(),
    });
    
    const descriptions = registry.getToolDescriptions();
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0].category).toBe(ToolCategory.FILE_OPERATION);
    expect(descriptions[0].alwaysRequirePermission).toBe(false);
  });
});