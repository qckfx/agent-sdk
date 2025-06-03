/**
 * Tests for the PromptManager
 */

import {
  BasicPromptManager,
  createPromptManager,
  createDefaultPromptManager,
} from '../PromptManager.js';
import { SessionState } from '../../types/model.js';

describe('PromptManager', () => {
  describe('BasicPromptManager', () => {
    it('should return the default prompt when no custom prompt is provided', () => {
      const promptManager = new BasicPromptManager();
      const prompt = promptManager.getSystemPrompt();

      // Just check that a non-empty string is returned
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should return the custom prompt when provided', () => {
      const customPrompt = 'This is a custom prompt';
      const promptManager = new BasicPromptManager(customPrompt);
      const prompt = promptManager.getSystemPrompt();

      expect(prompt).toBe(customPrompt);
    });

    it('should enhance the prompt with tool error context if available', () => {
      const promptManager = new BasicPromptManager();
      const sessionState: SessionState = {
        conversationHistory: [],
        lastToolError: {
          toolId: 'TestTool',
          error: 'Invalid arguments',
          args: {},
        },
      };

      const prompt = promptManager.getSystemPrompt(sessionState);

      expect(prompt).toContain('In your last tool call to TestTool');
      expect(prompt).toContain('you encountered this error: "Invalid arguments"');
    });

    it('should return default temperature of 0.2 when not specified', () => {
      const promptManager = new BasicPromptManager();
      const temperature = promptManager.getTemperature();

      expect(temperature).toBe(0.2);
    });

    it('should use custom temperature when provided', () => {
      const customPrompt = 'Custom prompt';
      const customTemperature = 0.7;
      const promptManager = new BasicPromptManager(customPrompt, customTemperature);
      const temperature = promptManager.getTemperature();

      expect(temperature).toBe(customTemperature);
    });

    // New tests for multi-prompt support
    describe('getSystemPrompts', () => {
      it('should return array with just base prompt by default', () => {
        const promptManager = new BasicPromptManager();
        const prompts = promptManager.getSystemPrompts();

        expect(Array.isArray(prompts)).toBe(true);
        expect(prompts.length).toBe(1);
        expect(prompts[0].length).toBeGreaterThan(0);
      });

      it('should include directory structure when set', () => {
        const promptManager = new BasicPromptManager();
        const directoryStructure =
          '<context name="directoryStructure">Test directory structure</context>';

        // Set the directory structure
        promptManager.setDirectoryStructurePrompt(directoryStructure);

        // Get the prompts and verify
        const prompts = promptManager.getSystemPrompts();
        expect(prompts.length).toBe(2);
        expect(prompts[1]).toBe(directoryStructure);
      });

      it('should add error context as a separate prompt', () => {
        const promptManager = new BasicPromptManager();
        // First add directory structure
        const directoryStructure =
          '<context name="directoryStructure">Test directory structure</context>';
        promptManager.setDirectoryStructurePrompt(directoryStructure);

        // Create error context
        const sessionState: SessionState = {
          conversationHistory: [],
          lastToolError: {
            toolId: 'TestTool',
            error: 'Test error message',
            args: {},
          },
        };

        // Get prompts with error
        const prompts = promptManager.getSystemPrompts(sessionState);

        // Verify order and content
        expect(prompts.length).toBe(3);
        expect(prompts[1]).toBe(directoryStructure);
        expect(prompts[2]).toContain('TestTool');
        expect(prompts[2]).toContain('Test error message');
      });

      it('should add tool limit warning as last prompt', () => {
        const promptManager = new BasicPromptManager();
        // Create session with error and tool limit
        const sessionState: SessionState = {
          conversationHistory: [],
          lastToolError: {
            toolId: 'TestTool',
            error: 'Test error message',
            args: {},
          },
          toolLimitReached: true,
        };

        // Get prompts with all contexts
        const prompts = promptManager.getSystemPrompts(sessionState);

        // Verify order and content
        expect(prompts.length).toBe(3);
        expect(prompts[1]).toContain('TestTool');
        expect(prompts[2]).toContain('You have reached the maximum limit');
      });

      it('should clear directory structure when set to null', () => {
        const promptManager = new BasicPromptManager();
        // First add directory structure
        const directoryStructure =
          '<context name="directoryStructure">Test directory structure</context>';
        promptManager.setDirectoryStructurePrompt(directoryStructure);

        // Verify it's added
        expect(promptManager.getSystemPrompts().length).toBe(2);

        // Now clear it
        promptManager.setDirectoryStructurePrompt(null);

        // Verify it's removed
        expect(promptManager.getSystemPrompts().length).toBe(1);
      });
    });
  });

  describe('createDefaultPromptManager', () => {
    it('should create a BasicPromptManager with the default prompt', () => {
      const promptManager = createDefaultPromptManager();
      const prompt = promptManager.getSystemPrompt();

      // Just check that a non-empty string is returned
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should allow overriding the default temperature', () => {
      const customTemperature = 0.8;
      const promptManager = createDefaultPromptManager(customTemperature);
      const temperature = promptManager.getTemperature();

      expect(temperature).toBe(customTemperature);
    });
  });

  describe('createPromptManager', () => {
    it('should create a BasicPromptManager with a custom prompt', () => {
      const customPrompt = 'This is a custom prompt';
      const promptManager = createPromptManager(customPrompt);
      const prompt = promptManager.getSystemPrompt();

      expect(prompt).toBe(customPrompt);
    });

    it('should create a BasicPromptManager with custom prompt and temperature', () => {
      const customPrompt = 'This is a custom prompt';
      const customTemperature = 0.5;
      const promptManager = createPromptManager(customPrompt, customTemperature);

      const prompt = promptManager.getSystemPrompt();
      const temperature = promptManager.getTemperature();

      expect(prompt).toBe(customPrompt);
      expect(temperature).toBe(customTemperature);
    });
  });
});
