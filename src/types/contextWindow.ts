/**
 * ContextWindow - Manages conversation context and file access tracking
 */

import { Anthropic } from '@anthropic-ai/sdk';

export class ContextWindow {
  // Public conversation history
  private _messages: Anthropic.Messages.MessageParam[];
  
  // Private file tracking
  private _filesRead: Set<string>;
  
  constructor(messages?: Anthropic.Messages.MessageParam[]) {
    this._messages = messages || [];
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

  public getMessages(): Anthropic.Messages.MessageParam[] {
    return this._messages;
  }

  public push(message: Anthropic.Messages.MessageParam): void {
    this._messages.push(message);
  }

  // ----------------------------------------------------------------------
  // Typed helper methods to make conversation‑history mutations safer.
  // ----------------------------------------------------------------------

  public pushUser(text: string): void {
    this.push({ role: 'user', content: [{ type: 'text', text }] });
    this.validate();
  }

  public pushAssistant(blocks: Anthropic.Messages.ContentBlockParam[]): void {
    this.push({ role: 'assistant', content: blocks });
    this.validate();
  }

  public pushToolUse(toolUse: { id: string; name: string; input: Record<string, unknown> }): void {
    this.push({
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
  }

  public pushToolResult(toolUseId: string, result: unknown): void {
    this.push({
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
  }

  // ----------------------------------------------------------------------
  // Development‑time invariant check (runs only when NODE_ENV === 'dev')
  // ----------------------------------------------------------------------

  private validate(): void {
    // Only run expensive invariant checks during development and test runs.
    // The custom ambient type for NODE_ENV only allows 'development' | 'production' | 'test'.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') return;

    for (let i = 0; i < this._messages.length; i++) {
      const msg = this._messages[i];
      const first = Array.isArray(msg.content) ? (msg.content[0] as any) : undefined;

      if (first?.type === 'tool_use') {
        const next = this._messages[i + 1];

        // If this is the last message so far, we are likely in the middle of
        // the tool‑execution flow. Defer validation until another message is
        // appended (either the tool_result or an abort).
        if (!next) continue;

        const ok =
          Array.isArray(next.content) &&
          next.content[0]?.type === 'tool_result' &&
          next.content[0]?.tool_use_id === first.id;

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
    this._messages = messages;
  }
}

// Factory function for creating new context windows
export function createContextWindow(messages?: Anthropic.Messages.MessageParam[]): ContextWindow {
  return new ContextWindow(messages);
}