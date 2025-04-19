/**
 * PromptManager - Manages system prompts for the agent
 * 
 * This module is responsible for creating and managing the system prompts that control
 * the agent's behavior. It supports multiple system messages including:
 * 1. The base prompt (general instructions)
 * 2. Directory structure context (repository layout)
 * 3. Error context (for handling tool errors)
 * 4. Tool limit warnings
 * 
 * The new architecture uses multiple separate system messages, which provides advantages
 * for caching and prompt organization.
 */

import { SessionState } from '../types/model.js';

/**
 * Interface for prompt managers that generate system prompts
 */
export interface PromptManager {
  /**
   * Returns a system prompt based on the current session state
   * @param sessionState Current session state
   * @returns A system prompt string
   * @deprecated Use getSystemPrompts() instead for multi-prompt support
   */
  getSystemPrompt(sessionState?: SessionState): string;
  
  /**
   * Returns an array of system prompts based on the current session state
   * @param sessionState Current session state
   * @returns An array of system prompt strings
   */
  getSystemPrompts(sessionState?: SessionState): string[];
  
  /**
   * Returns the temperature setting based on the current session state
   * @param sessionState Current session state
   * @returns A temperature value between 0 and 1
   */
  getTemperature(sessionState?: SessionState): number;
  
  /**
   * Sets the directory structure prompt
   * @param directoryStructure Directory structure string or null to clear
   */
  setDirectoryStructurePrompt(directoryStructure: string | null): void;
  
  /**
   * Sets the git state prompt
   * @param gitState Git state string or null to clear
   */
  setGitStatePrompt(gitState: string | null): void;
}

// Default system prompt used for all interactions
const DEFAULT_SYSTEM_PROMPT = "You are a precise, efficient AI assistant that helps users with software development tasks.\n\nAlways prioritize using the appropriate tools to solve problems rather than generating information from your knowledge. When a user asks a question, think about which tool will provide the most accurate answer with minimal steps.\n\nFollow these key principles:\n1. START SIMPLE - Begin with the most direct approach before trying complex solutions\n2. BE OBSERVANT - Carefully examine tool outputs before deciding next actions\n3. BE ADAPTIVE - Learn from errors and adjust your approach quickly\n4. BE PRECISE - Pay close attention to parameter requirements and file paths\n5. BE EFFICIENT - Minimize redundant tool calls and unnecessary operations\n\nWhen searching codebases:\n- MAP FIRST - Start by understanding the directory structure to build context\n- USE TARGETED PATTERNS - Begin with specific search terms, then broaden if needed\n- COMBINE TOOLS EFFECTIVELY - Use GlobTool to identify file types, then GrepTool for content, finally View for examination\n- FOLLOW RELATIONSHIPS - After finding relevant files, explore related components and dependencies\n- AVOID TRIAL-AND-ERROR - Plan your search strategy before execution, refining based on results\n- USE BATCHTOOL FOR MULTIPLE SEARCHES - When you need to run multiple searches with different patterns or read multiple files at once, use BatchTool to execute them in parallel\n\nWhen implementing changes:\n- ANALYZE ARCHITECTURE - Understand the system design and component relationships before making changes\n- FOLLOW EXISTING PATTERNS - Ensure new code matches existing patterns, naming conventions, and error handling\n- IMPLEMENT COMPLETELY - Include error handling, edge cases, and proper integration with existing components\n- VERIFY ALL CHANGES - Test your implementation thoroughly, including running tests, type checks, and linting\n- CONSIDER A TASK INCOMPLETE until you've verified it works through appropriate testing\n\nWhen handling files and paths:\n- ALWAYS USE ABSOLUTE PATHS - Convert relative paths using path.resolve() or similar platform-specific utilities\n- VALIDATE PATH EXISTENCE - Check if paths exist before reading/writing operations\n- USE PROPER ERROR HANDLING - Catch and handle file operation errors gracefully\n\nWhen solving problems:\n- Break complex tasks into discrete steps with verification at each stage\n- Implement complete solutions that handle edge cases and error conditions\n- After implementing, reflect on whether your solution is robust, maintainable, and performant\n- Always provide working examples that users can immediately apply\n\nTool usage best practices:\n- USE BATCHTOOL FOR PARALLEL OPERATIONS - When performing multiple independent operations (like reading multiple files, running multiple searches, or checking multiple conditions), use the BatchTool to execute them in parallel\n- BATCHTOOL FOR RESEARCH - When exploring a codebase, use BatchTool to run multiple GlobTool and GrepTool operations simultaneously\n- BATCHTOOL FOR MULTIPLE EDITS - When making multiple edits to the same file, use BatchTool to execute all changes at once\n- BATCHTOOL FOR SPEED - Use BatchTool to dramatically improve response time and reduce context usage by avoiding back-and-forth with the model\n\nIf a tool call fails, analyze the error carefully before trying again with corrected parameters. Track your progress methodically and never repeat unsuccessful approaches without addressing the underlying issue.";

/**
 * Basic implementation of the PromptManager that uses a fixed system prompt
 * and enhances it with context from the session state
 */
export class BasicPromptManager implements PromptManager {
  private readonly basePrompt: string;
  private readonly defaultTemperature: number;
  private directoryStructurePrompt: string | null = null;
  private gitStatePrompt: string | null = null;
  
  /**
   * Create a prompt manager with a fixed base prompt
   * @param basePrompt The base system prompt to use
   * @param defaultTemperature The default temperature to use (0.0-1.0)
   */
  constructor(basePrompt: string = DEFAULT_SYSTEM_PROMPT, defaultTemperature: number = 0.2) {
    this.basePrompt = basePrompt;
    this.defaultTemperature = defaultTemperature;
  }
  
  /**
   * @deprecated Use getSystemPrompts() instead for multi-prompt support
   */
  getSystemPrompt(sessionState?: SessionState): string {
    // For backward compatibility, combine all prompts into one string
    return this.getSystemPrompts(sessionState).join('\n\n');
  }
  
  /**
   * Returns all system prompts as an array
   * Organizes system messages for optimal caching:
   * 1. Base prompt (most stable, most cacheable)
   * 2. Directory structure (stable within a repository)
   * 3. Git state (updated per iteration)
   * 4. Error context (changes per iteration)
   * 5. Tool limit warning (only added when needed)
   */
  getSystemPrompts(sessionState?: SessionState): string[] {
    // Start with the most stable prompts
    const prompts = [this.basePrompt];
    
    // Add directory structure prompt if available (relatively stable)
    if (this.directoryStructurePrompt) {
      prompts.push(this.directoryStructurePrompt);
    }
    
    // Add git state prompt if available (updated per iteration)
    if (this.gitStatePrompt) {
      prompts.push(this.gitStatePrompt);
    }
    
    // Add error context as a separate message if available (changes frequently)
    if (sessionState?.lastToolError) {
      const errorContext = `In your last tool call to ${sessionState.lastToolError.toolId}, ` +
        `you encountered this error: "${sessionState.lastToolError.error}". ` +
        "Please correct your approach accordingly.";
      
      prompts.push(errorContext);
    }
    
    // Add tool limit reached context as the last message if applicable (most dynamic)
    if (sessionState?.toolLimitReached) {
      const toolLimitMessage = `You have reached the maximum limit of tool operations for this session.

Please summarize what you've accomplished so far and what remains to be done. 
Check in with the user on how they'd like to proceed. The user can continue with a new message.

DO NOT suggest using more tools - you have reached your limit for this interaction.`;
      
      prompts.push(toolLimitMessage);
    }
    
    return prompts;
  }
  
  getTemperature(_sessionState?: SessionState): number {
    // For now, we just return a fixed temperature
    // In the future, this could adjust based on session state
    // For example, use a higher temperature for creative tasks
    // or a lower temperature for precise reasoning
    return this.defaultTemperature;
  }
  
  setDirectoryStructurePrompt(directoryStructure: string | null): void {
    this.directoryStructurePrompt = directoryStructure;
  }
  
  /**
   * Sets the git state prompt
   * @param gitState Git state information string or null to clear
   */
  setGitStatePrompt(gitState: string | null): void {
    this.gitStatePrompt = gitState;
  }
}

/**
 * Creates a prompt manager with the default system prompt
 * @param temperature Optional temperature override (defaults to 0.2)
 * @returns A new prompt manager instance
 */
export function createDefaultPromptManager(temperature?: number): PromptManager {
  return new BasicPromptManager(undefined, temperature);
}

/**
 * Creates a prompt manager with a custom system prompt
 * @param basePrompt The base system prompt to use
 * @param temperature Optional temperature override (defaults to 0.2)
 * @returns A new prompt manager instance
 */
export function createPromptManager(basePrompt: string, temperature?: number): PromptManager {
  return new BasicPromptManager(basePrompt, temperature);
}