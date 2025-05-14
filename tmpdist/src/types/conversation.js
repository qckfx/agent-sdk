/**
 * ConversationMessage – our wrapper around Anthropic's MessageParam that adds
 * a stable, SDK‑agnostic identifier and lightweight metadata we need for
 * bookkeeping (checkpoints, UI look‑ups, etc.).
 *
 * NOTE:  We deliberately keep the wrapper minimal.  Extra fields can be added
 * later without changing the external contract because consumer code continues
 * to access the raw Anthropic object via the `anthropic` property or via
 * `ContextWindow.getMessages()` which exposes only the Anthropic shape.
 */
export {};
//# sourceMappingURL=conversation.js.map