/**
 * Test cases for comparing system prompt performance
 */

import { TestCase } from './types.js';

/**
 * All available test cases for evaluating prompt effectiveness
 */
export const testCases: TestCase[] = [
  // Exploration test cases
  {
    id: 'explore-1',
    name: 'Find Permission Manager',
    instructions: 'Find the implementation of the permission manager system in this codebase',
    type: 'exploration',
  },
  {
    id: 'explore-2',
    name: 'Find Tool Registry',
    instructions: 'How does the tool registry work in this project?',
    type: 'exploration',
  },

  // Debugging test cases
  {
    id: 'debug-1',
    name: 'Debug File Read Error',
    instructions:
      'When I try to read a file with the FileReadTool, I get an error saying "path must be absolute". How do I fix this?',
    type: 'debugging',
  },

  // Implementation test cases
  {
    id: 'implement-1',
    name: 'Add Simple Logger',
    instructions:
      'Add a simple logging function that tracks which tools are being used and how often',
    type: 'implementation',
  },

  // Analysis test cases
  {
    id: 'analyze-1',
    name: 'Explain Agent Architecture',
    instructions:
      'Explain the overall architecture of this agent system and how the components interact',
    type: 'analysis',
  },
];

/**
 * Get a specific test case by ID
 */
export function getTestCase(id: string): TestCase | undefined {
  return testCases.find(tc => tc.id === id);
}

/**
 * Get test cases by type
 */
export function getTestCasesByType(type: TestCase['type']): TestCase[] {
  return testCases.filter(tc => tc.type === type);
}

/**
 * Get a subset of test cases for quick evaluation (one per type)
 */
export function getQuickTestCases(): TestCase[] {
  const types = new Set(testCases.map(tc => tc.type));
  return Array.from(types)
    .map(type => testCases.find(tc => tc.type === type))
    .filter(Boolean) as TestCase[];
}
