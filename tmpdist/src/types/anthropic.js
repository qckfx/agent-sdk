/**
 * Types and interfaces for Anthropic provider
 */
/**
 * Type guard to check if a content block is a TextBlock
 * Compatible with both our internal types and Anthropic SDK types
 */
export function isTextBlock(block) {
    return block && block.type === 'text' && 'text' in block;
}
/**
 * Type guard to check if a content block is a ToolUseBlock
 * Compatible with both our internal types and Anthropic SDK types
 */
export function isToolUseBlock(block) {
    return block && block.type === 'tool_use' && 'id' in block && 'name' in block && 'input' in block;
}
//# sourceMappingURL=anthropic.js.map