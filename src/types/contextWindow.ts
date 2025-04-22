/**
 * ContextWindow - Manages conversation context and file access tracking
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { nanoid } from 'nanoid';
import { ConversationMessage } from './conversation.js';

export class ContextWindow {
  // Internal conversation history (wrapper objects)
  private _messages: ConversationMessage[];
  
  // Private file tracking
  private _filesRead: Set<string>;
  
  constructor(messages?: Anthropic.Messages.MessageParam[]) {
    // If we were given raw Anthropic messages, wrap them so we maintain a
    // consistent internal shape.  This scenario happens mainly in tests.
    if (messages) {
      this._messages = messages.map((m) => ({ id: nanoid(), anthropic: m, createdAt: Date.now() }));
    } else {
      this._messages = [];
    }
    this._filesRead = new Set<string>();
  }
  
  /**
   * Record a file being read in the current context
   */
  public recordFileRead(filePath: string): void {
    this._filesRead.add(filePath);
  }
  
  /**
   * Check if a file has been read in the current context
   */
  public hasReadFile(filePath: string): boolean {
    return this._filesRead.has(filePath);
  }
  
  /**
   * Clear all file tracking data when context is refreshed
   */
  public clearFileTracking(): void {
    this._filesRead.clear();
  }
  
  /**
   * Get list of all files read in current context (for debugging)
   */
  public getReadFiles(): string[] {
    return Array.from(this._filesRead);
  }

  /**
   * Return ONLY the Anthropic messages for callers that speak the original
   * API.  No new code inside the repo should rely on positional indexes; use
   * the wrapper objects instead when you need metadata.
   */
  public getMessages(): Anthropic.Messages.MessageParam[] {
    return this._messages.map((m) => m.anthropic);
  }

  /**
   * Return the full wrapper objects (mostly for internal use / debugging).
   */
  public getConversationMessages(): ConversationMessage[] {
    return this._messages;
  }
  
  /**
   * Returns the last message in the conversation, or undefined if there are no messages.
   */
  public peek(): ConversationMessage | undefined {
    if (this._messages.length === 0) {
      return undefined;
    }
    return this._messages[this._messages.length - 1];
  }

  public push(message: Anthropic.Messages.MessageParam): string {
    const id = nanoid();
    this._messages.push({ id, anthropic: message, createdAt: Date.now() });
    return id;
  }

  // ----------------------------------------------------------------------
  // Typed helper methods to make conversation‑history mutations safer.
  // ----------------------------------------------------------------------

  public pushUser(text: string): string {
    const id = this.push({ role: 'user', content: [{ type: 'text', text }] });
    this.validate();
    return id;
  }

  public pushAssistant(blocks: Anthropic.Messages.ContentBlockParam[]): string {
    const id = this.push({ role: 'assistant', content: blocks });
    this.validate();
    return id;
  }

  public pushToolUse(toolUse: { id: string; name: string; input: Record<string, unknown> }): string {
    const id = this.push({
      role: 'assistant',
      content: [
        {
          type: 'tool_use' as const,
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        },
      ],
    });
    this.validate();
    return id;
  }

  public pushToolResult(toolUseId: string, result: unknown): string {
    const id = this.push({
      role: 'user',
      content: [
        {
          type: 'tool_result' as const,
          tool_use_id: toolUseId,
          content: JSON.stringify(result),
        },
      ],
    });
    this.validate();
    return id;
  }

  // ----------------------------------------------------------------------
  // Development‑time invariant check (runs only when NODE_ENV === 'dev')
  // ----------------------------------------------------------------------

  private validate(): void {
    // Only run expensive invariant checks during development and test runs.
    // The custom ambient type for NODE_ENV only allows 'development' | 'production' | 'test'.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') return;

    for (let i = 0; i < this._messages.length; i++) {
      const msg = this._messages[i].anthropic;
      const first = Array.isArray(msg.content) ? (msg.content[0] as any) : undefined;

      if (first?.type === 'tool_use') {
        const next = this._messages[i + 1];

        // If this is the last message so far, we are likely in the middle of
        // the tool‑execution flow. Defer validation until another message is
        // appended (either the tool_result or an abort).
        if (!next) continue;

        const nextMsg = next.anthropic;
        const ok =
          Array.isArray(nextMsg.content) &&
          nextMsg.content[0]?.type === 'tool_result' &&
          nextMsg.content[0]?.tool_use_id === first.id;

        if (!ok) {
          throw new Error(
            `ContextWindow invariant violated: tool_use at index ${i} must be immediately followed by matching tool_result`,
          );
        }
      }
    }
  }
  
  public clear(): void {
    this._messages = [];
  }
  
  public getLength(): number {
    return this._messages.length;
  }
  
  public setMessages(messages: Anthropic.Messages.MessageParam[]): void {
    this._messages = messages.map((m) => ({ id: nanoid(), anthropic: m, createdAt: Date.now() }));
  }
}

// Factory function for creating new context windows
export function createContextWindow(messages?: Anthropic.Messages.MessageParam[]): ContextWindow {
  return new ContextWindow(messages);
}