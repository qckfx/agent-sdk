/**
 * Tests for tool usage analysis utilities
 */

import { analyzeExecutionToolUsage, analyzeAggregateToolUsage } from '../tool-analysis';
import { AgentExecutionHistory } from '../../models/types';
import { ABTestRunWithHistory } from '../../models/ab-types';

describe('Tool Usage Analysis', () => {
  // Mock execution history for testing
  const createMockHistory = (toolSequence: string[]): AgentExecutionHistory => {
    return {
      toolCalls: toolSequence.map(toolId => ({
        tool: toolId,
        args: {},
        result: `Result of ${toolId}`,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString()
      })),
      metadata: {
        task: "Test task"
      }
    };
  };
  
  test('analyzeExecutionToolUsage calculates correct statistics', () => {
    const toolSequence = ['glob', 'view', 'bash', 'view', 'view', 'glob'];
    const history = createMockHistory(toolSequence);
    
    const stats = analyzeExecutionToolUsage(history);
    
    expect(stats.total).toBe(6);
    expect(stats.uniqueTools).toBe(3);
    expect(stats.counts).toEqual({
      glob: 2,
      view: 3,
      bash: 1
    });
    expect(stats.percentages.glob).toBeCloseTo(33.33, 1);
    expect(stats.percentages.view).toBeCloseTo(50, 1);
    expect(stats.percentages.bash).toBeCloseTo(16.67, 1);
    expect(stats.sequence).toEqual(toolSequence);
  });
  
  test('analyzeExecutionToolUsage handles empty history', () => {
    const history: AgentExecutionHistory = {
      toolCalls: [],
      metadata: {
        task: "Empty test task"
      }
    };
    
    const stats = analyzeExecutionToolUsage(history);
    
    expect(stats.total).toBe(0);
    expect(stats.uniqueTools).toBe(0);
    expect(stats.counts).toEqual({});
    expect(stats.percentages).toEqual({});
    expect(stats.sequence).toEqual([]);
  });
  
  test('analyzeAggregateToolUsage calculates correct statistics across runs', () => {
    const runs: ABTestRunWithHistory[] = [
      {
        testCase: { id: 'test1', name: 'Test 1', instructions: 'Test', type: 'test' as any },
        metrics: { 
          testCase: 'Test 1',
          promptName: 'Test prompt',
          success: true, 
          duration: 1000, 
          toolCalls: 3,
          tokenUsage: { input: 100, output: 200, total: 300 }
        },
        executionHistory: createMockHistory(['glob', 'view', 'bash'])
      },
      {
        testCase: { id: 'test2', name: 'Test 2', instructions: 'Test', type: 'test' as any },
        metrics: { 
          testCase: 'Test 2',
          promptName: 'Test prompt',
          success: true, 
          duration: 1000, 
          toolCalls: 4,
          tokenUsage: { input: 100, output: 200, total: 300 }
        },
        executionHistory: createMockHistory(['view', 'view', 'edit', 'glob'])
      },
      {
        testCase: { id: 'test3', name: 'Test 3', instructions: 'Test', type: 'test' as any },
        metrics: { 
          testCase: 'Test 3',
          promptName: 'Test prompt',
          success: true, 
          duration: 1000, 
          toolCalls: 5,
          tokenUsage: { input: 100, output: 200, total: 300 }
        },
        executionHistory: createMockHistory(['glob', 'view', 'bash', 'view', 'glob'])
      }
    ];
    
    const stats = analyzeAggregateToolUsage(runs);
    
    expect(stats.avgTotal).toBeCloseTo(4, 1);
    expect(stats.avgUniqueTools).toBeCloseTo(3, 1);
    expect(stats.avgCounts.glob).toBeCloseTo(1.33, 1);
    expect(stats.avgCounts.view).toBeCloseTo(1.67, 1);
    expect(stats.avgCounts.bash).toBeCloseTo(0.67, 1);
    expect(stats.mostCommonFirstTool).toBe('glob');
    expect(stats.commonSequences.length).toBeGreaterThan(0);
  });
});