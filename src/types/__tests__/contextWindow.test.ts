import { describe, it, expect } from 'vitest';
import { ContextWindow } from '../contextWindow.js';
import type { LLM } from '../llm.js';

describe('ContextWindow', () => {
  describe('rollbackToMessage', () => {
    it('should remove messages up to and including the specified message ID', () => {
      // Create a context window with some messages
      const contextWindow = new ContextWindow();

      // Add some messages and capture their IDs
      const userMsg1Id = contextWindow.pushUser('Hello');
      const assistantMsg1Id = contextWindow.pushAssistant([{ type: 'text', text: 'Hi there' }]);
      const userMsg2Id = contextWindow.pushUser('How are you?');
      const assistantMsg2Id = contextWindow.pushAssistant([
        { type: 'text', text: 'I am doing well' },
      ]);

      // Initial length should be 4
      expect(contextWindow.getLength()).toBe(4);

      // Roll back to the second message
      const removedCount = contextWindow.rollbackToMessage(assistantMsg1Id);

      // Should have removed 2 messages (user1 and assistant1)
      expect(removedCount).toBe(2);

      // New length should be 2
      expect(contextWindow.getLength()).toBe(2);

      // Get the remaining messages
      const remainingMessages = contextWindow.getMessages();

      // The first remaining message should be the third original message
      expect(remainingMessages[0].role).toBe('user');
      expect((remainingMessages[0].content[0] as LLM.Messages.TextBlock).text).toBe('How are you?');

      // The second remaining message should be the fourth original message
      expect(remainingMessages[1].role).toBe('assistant');
      expect((remainingMessages[1].content[0] as LLM.Messages.TextBlock).text).toBe(
        'I am doing well',
      );
    });

    it('should return 0 if message ID is not found', () => {
      const contextWindow = new ContextWindow();
      contextWindow.pushUser('Hello');

      const removedCount = contextWindow.rollbackToMessage('non-existent-id');

      expect(removedCount).toBe(0);
      expect(contextWindow.getLength()).toBe(1);
    });

    it('should remove all messages if the target message is the last one', () => {
      const contextWindow = new ContextWindow();
      const msg1Id = contextWindow.pushUser('Hello');
      const msg2Id = contextWindow.pushAssistant([{ type: 'text', text: 'Hi there' }]);

      const removedCount = contextWindow.rollbackToMessage(msg2Id);

      expect(removedCount).toBe(2);
      expect(contextWindow.getLength()).toBe(0);
    });
  });
});
