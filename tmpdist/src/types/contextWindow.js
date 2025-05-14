/**
 * ContextWindow - Manages conversation context and file access tracking
 */
import { nanoid } from 'nanoid';
export class ContextWindow {
    constructor(messages) {
        // If we were given raw Anthropic messages, wrap them so we maintain a
        // consistent internal shape.  This scenario happens mainly in tests.
        if (messages) {
            this._messages = messages.map((m) => ({
                id: nanoid(),
                anthropic: m,
                createdAt: Date.now(),
                lastCheckpointId: this._lastCheckpointId,
            }));
        }
        else {
            this._messages = [];
        }
        this._filesRead = new Set();
    }
    /**
     * Get the identifier of the latest checkpoint known to the context
     */
    getLastCheckpointId() {
        return this._lastCheckpointId;
    }
    /**
     * Update the context's notion of the most recent checkpoint.  All
     * subsequently pushed messages will store this value so that rollbacks can
     * resolve the correct commit even for read‑only events.
     */
    setLastCheckpointId(id) {
        this._lastCheckpointId = id;
    }
    /**
     * Record a file being read in the current context
     */
    recordFileRead(filePath) {
        this._filesRead.add(filePath);
    }
    /**
     * Check if a file has been read in the current context
     */
    hasReadFile(filePath) {
        return this._filesRead.has(filePath);
    }
    /**
     * Clear all file tracking data when context is refreshed
     */
    clearFileTracking() {
        this._filesRead.clear();
    }
    /**
     * Get list of all files read in current context (for debugging)
     */
    getReadFiles() {
        return Array.from(this._filesRead);
    }
    /**
     * Return ONLY the Anthropic messages for callers that speak the original
     * API.  No new code inside the repo should rely on positional indexes; use
     * the wrapper objects instead when you need metadata.
     */
    getMessages() {
        return this._messages.map((m) => m.anthropic);
    }
    /**
     * Return the full wrapper objects (mostly for internal use / debugging).
     */
    getConversationMessages() {
        return this._messages;
    }
    /**
     * Returns the last message in the conversation, or undefined if there are no messages.
     */
    peek() {
        if (this._messages.length === 0) {
            return undefined;
        }
        return this._messages[this._messages.length - 1];
    }
    push(message) {
        const id = nanoid();
        this._messages.push({
            id,
            anthropic: message,
            createdAt: Date.now(),
            lastCheckpointId: this._lastCheckpointId,
        });
        return id;
    }
    // ----------------------------------------------------------------------
    // Typed helper methods to make conversation‑history mutations safer.
    // ----------------------------------------------------------------------
    pushUser(text) {
        const id = this.push({ role: 'user', content: [{ type: 'text', text }] });
        this.validate();
        return id;
    }
    pushAssistant(blocks) {
        const id = this.push({ role: 'assistant', content: blocks });
        this.validate();
        return id;
    }
    pushToolUse(toolUse) {
        const id = this.push({
            role: 'assistant',
            content: [
                {
                    type: 'tool_use',
                    id: toolUse.id,
                    name: toolUse.name,
                    input: toolUse.input,
                },
            ],
        });
        this.validate();
        return id;
    }
    pushToolResult(toolUseId, result) {
        const id = this.push({
            role: 'user',
            content: [
                {
                    type: 'tool_result',
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
    validate() {
        // Only run expensive invariant checks during development and test runs.
        // The custom ambient type for NODE_ENV only allows 'development' | 'production' | 'test'.
        if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test')
            return;
        for (let i = 0; i < this._messages.length; i++) {
            const msg = this._messages[i].anthropic;
            const first = Array.isArray(msg.content) ? msg.content[0] : undefined;
            if (first?.type === 'tool_use') {
                const next = this._messages[i + 1];
                // If this is the last message so far, we are likely in the middle of
                // the tool‑execution flow. Defer validation until another message is
                // appended (either the tool_result or an abort).
                if (!next)
                    continue;
                const nextMsg = next.anthropic;
                const ok = Array.isArray(nextMsg.content) &&
                    nextMsg.content[0]?.type === 'tool_result' &&
                    nextMsg.content[0]?.tool_use_id === first.id;
                if (!ok) {
                    throw new Error(`ContextWindow invariant violated: tool_use at index ${i} must be immediately followed by matching tool_result`);
                }
            }
        }
    }
    clear() {
        this._messages = [];
    }
    getLength() {
        return this._messages.length;
    }
    setMessages(messages) {
        this._messages = messages.map((m) => ({
            id: nanoid(),
            anthropic: m,
            createdAt: Date.now(),
            lastCheckpointId: this._lastCheckpointId,
        }));
    }
    /**
     * Removes messages from the context window up to and including the message with the given ID.
     * @param messageId The ID of the message to roll back to (inclusive)
     * @returns The number of messages removed
     */
    rollbackToMessage(messageId) {
        const index = this._messages.findIndex(message => message.id === messageId);
        if (index === -1) {
            return 0;
        }
        // Remove all messages up to and including the specified message
        const removed = this._messages.splice(0, index + 1);
        // After trimming, update our cached checkpoint to match the newest
        // remaining message so that subsequent pushes inherit the correct value.
        const latest = this._messages[this._messages.length - 1];
        this._lastCheckpointId = latest?.lastCheckpointId;
        return removed.length;
    }
}
// Factory function for creating new context windows
export function createContextWindow(messages) {
    return new ContextWindow(messages);
}
//# sourceMappingURL=contextWindow.js.map