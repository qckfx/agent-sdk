/**
 * Types for structured message content
 */
import { z } from 'zod';

/**
 * Base content part with type discriminator
 */
export interface ContentPartBase {
  type: string;
}

/**
 * Text content part
 */
export interface TextContentPart extends ContentPartBase {
  type: 'text';
  text: string;
}

/**
 * Image content part (for future use)
 */
export interface ImageContentPart extends ContentPartBase {
  type: 'image';
  url: string;
  alt?: string;
}

/**
 * Code block content part (for future use)
 */
export interface CodeBlockContentPart extends ContentPartBase {
  type: 'code';
  code: string;
  language?: string;
}

/**
 * Union type of all content part types
 */
export type ContentPart = TextContentPart | ImageContentPart | CodeBlockContentPart;

/**
 * Structured message content as array of content parts
 */
export type StructuredContent = ContentPart[];

/**
 * Zod schema for content parts
 */
export const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string()
});

export const imageContentSchema = z.object({
  type: z.literal('image'),
  url: z.string(),
  alt: z.string().optional()
});

export const codeBlockContentSchema = z.object({
  type: z.literal('code'),
  code: z.string(),
  language: z.string().optional()
});

export const contentPartSchema = z.discriminatedUnion('type', [
  textContentSchema,
  imageContentSchema,
  codeBlockContentSchema
]);

export const structuredContentSchema = z.array(contentPartSchema);

/**
 * Parse content string to structured content
 * @param content String that might be a JSON representation of structured content
 * @returns Parsed StructuredContent or null if parsing fails
 */
export function parseStructuredContent(content: string): StructuredContent | null {
  try {
    const parsed = JSON.parse(content);
    const result = structuredContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch (e) {
    return null;
  }
}

export interface Message {
  /**
   * Unique message ID
   */
  id: string;
  
  /**
   * Message sender role
   */
  role: 'user' | 'assistant';
  
  /**
   * ISO timestamp of when the message was created
   */
  timestamp: string;
  
  /**
   * Structured message content as array of content parts
   */
  content: StructuredContent;
  
  /**
   * References to tool calls made within this message
   */
  toolCalls?: ToolCallReference[];
  
  /**
   * ID of the parent message (if this is a response)
   */
  parentMessageId?: string;
}

/**
 * Reference to a tool call in a stored message
 */
export interface ToolCallReference {
  /**
   * Unique ID of the tool execution
   */
  executionId: string;
  
  /**
   * Original tool use ID from the Anthropic API
   */
  toolUseId?: string;
  
  /**
   * Display name of the tool
   */
  toolName: string;
  
  /**
   * Whether the tool was invoked as part of a batch
   */
  isBatchedCall?: boolean;
  
  /**
   * Index of this call in the original message
   */
  index: number;
}

// IMPORTANT: These cannot be added to sessionUtils because they are used in browser/internals/index.ts
// sessionUtils is only exported for Node.js because it uses Node.js-specific event emitter apis.
export interface MessageAddedEvent {
  sessionId: string;
  message: Message;
}

export interface MessageUpdatedEvent {
  sessionId: string;
  message: Message;
  messageId: string;
}