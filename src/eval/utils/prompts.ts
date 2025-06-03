/**
 * Prompt utilities for AI judge evaluation
 */

import { AgentExecutionHistory } from '../models/types.js';
import { formatExecutionHistoryForJudge } from './execution-history.js';

/**
 * System prompt for the judge
 */
export const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator of AI agent outputs for software engineering tasks.
Your goal is to objectively assess the quality of an agent's approach and response.

MOST IMPORTANT: Heavily base your evaluation on the agent's FINAL RESPONSE and ANY CODE WRITTEN. These are the primary outputs that matter.
The agent's thinking steps and tool usage should be used to validate how thoroughly or efficiently it arrived at the response and code.

You have full access to the codebase and MUST use tools like grep, glob, ls, and file reading to verify claims. 
Don't just rely on what the agent says - use tools to independently verify their claims and check their work.

ACTIVELY USE THESE TOOLS to thoroughly validate the agent's work:
- Verify if the files and code the agent mentions actually exist
- Check if the agent's understanding of the codebase is accurate
- Test if solutions would actually work as proposed
- Identify if important files or code patterns were missed
- Compare the agent's approach with existing patterns in the codebase
- Write and run tests to validate code logic the agent produced
- Use Bash to execute tests or try out commands the agent suggested
- Run lint and typechecking tools to confirm code quality and correctness
- Examine git history or code changes to verify accuracy of agent's claims
- Check for missing error handling or edge cases in the agent's solution
- Verify if the agent's solution matches project coding style and conventions
- Try compiling/building code to confirm it works without errors

You will be evaluating the agent's performance across multiple dimensions including:
- Correctness - Is the solution technically accurate? Does it solve the right problem? Does it work correctly?
- Completeness - Does it fully address the problem? Are there missing elements?
- Efficiency - Is the solution efficient and was the agent's approach direct? Did it waste time or resources?
- Code Quality - Is any code produced clean and readable? Does it follow best practices?
- Explanations - Are the explanations clear, helpful, and accurate? Do they help the user understand?
- Tool Usage - Did the agent use appropriate tools effectively? Did it use the right tools for the job?
- Problem Solving - Did the agent take a logical approach to solving the problem? Did it demonstrate good reasoning?

IMPORTANT FOR TOOL USAGE EVALUATION: 
When evaluating the "Tool Usage" dimension, only consider the tools that were actually available to the agent as specified in the prompt. 
Do not penalize the agent for not using tools it didn't have access to. You will be informed about which tools the agent had access to in the prompt.

Your evaluation must be evidence-based. Use the agent's final response, any code it wrote, and its execution history to verify claims.
Be strict, critical, and fair in your assessment, focusing on the actual outputs produced.

CRITICAL GUIDELINES FOR SCORING:
1. Use the FULL RANGE of scores (1-10) for evaluation:
   - 1-3: Poor performance (incorrect, misleading, nonsensical responses)
   - 4-6: Mediocre performance (partially correct but major deficiencies)
   - 7-10: Good performance (correct, thorough, efficient solutions)

2. NEVER inflate scores. Give low scores when appropriate:
   - If an agent provides incorrect solutions, scores should be 1-3
   - If an agent tries but fails to complete the task, scores should not exceed 5
   - If an agent provides humorous responses instead of solutions, score 1-2
   - If an agent is deliberately misleading, score 1

3. Evidence-based evaluation:
   - Verify all claims by checking the actual output, not what the agent says it did
   - Do not be swayed by confident language - look at concrete results
   - Be skeptical and look for evidence of actual successful completion
   - Check if the code would actually work - don't accept plausible-looking but broken code

4. Focus on outcomes, not efforts:
   - Good intentions do not translate to good scores if results are poor
   - Judge based on what was actually achieved, not what was attempted
   - Use concrete evidence from the execution history to justify all scores
   - The FINAL RESPONSE and ANY CODE WRITTEN are the primary outcomes to evaluate

5. Consistency check:
   - Ensure your numerical scores match your written explanations
   - If you describe serious flaws, the score should be appropriately low
   - Don't contradict yourself by pointing out major issues but giving average scores`;

/**
 * Options for creating judging prompts
 */
export interface JudgingPromptOptions {
  /** The task the agent was given */
  task: string;

  /** The execution history to evaluate */
  executionHistory: AgentExecutionHistory;

  /** Examples for calibration (optional) */
  examples?: {
    good?: AgentExecutionHistory;
    bad?: AgentExecutionHistory;
  };

  /** Override the system prompt (optional) */
  systemPromptOverride?: string;
}

/**
 * Create a judging prompt with execution history and examples
 */
export function createJudgingPrompt(options: JudgingPromptOptions): string {
  const { task, executionHistory, examples } = options;

  let prompt = `
# TASK EVALUATION REQUEST

I need you to evaluate an AI agent's performance on a software engineering task.

## TASK DESCRIPTION
${task}
`;

  // Add tool availability information if present in the metadata
  if (executionHistory.metadata?.configInfo?.availableTools) {
    const tools = executionHistory.metadata.configInfo.availableTools;
    let toolInfo: string;

    if (Array.isArray(tools)) {
      toolInfo = tools.join(', ');
    } else {
      toolInfo = String(tools); // Convert to string in case it's not a string
    }

    prompt += `
## AVAILABLE TOOLS
The agent had access to these tools: ${toolInfo}.

When evaluating the agent's performance, particularly its tool usage, please consider whether it effectively utilized the available tools and only judge it based on tools it had access to.
`;
  }

  prompt += `
## AGENT EXECUTION HISTORY
${formatExecutionHistoryForJudge(executionHistory)}
`;

  // Add examples if they exist
  if (examples) {
    prompt += `
## EVALUATION EXAMPLES
To help calibrate your assessment, here are examples of good and bad agent behaviors:
`;

    // Add good example
    if (examples.good) {
      prompt += `
### GOOD EXAMPLE
${formatExecutionHistoryForJudge(examples.good)}

This is a good example because:
- It uses appropriate tools efficiently
- It takes a logical, systematic approach
- It produces correct, complete solutions
- The code quality and explanations are clear
`;
    }

    // Add bad example
    if (examples.bad) {
      prompt += `
### BAD EXAMPLE
${formatExecutionHistoryForJudge(examples.bad)}

This is a problematic example because:
- It uses inappropriate or inefficient tools
- It takes a convoluted or illogical approach
- It produces incorrect or incomplete solutions
- The code quality or explanations are poor
- It might attempt to be humorous instead of solving the problem
- It might purposely mislead or give nonsensical answers
- It might give up too easily or not address the core issue
`;
    }
  }

  // Add evaluation instructions
  prompt += `
## EVALUATION INSTRUCTIONS

MOST IMPORTANT: You should base your evaluation PRIMARILY on the quality of the agent's final response. The agent's thinking steps and tool usage should be evaluated in terms of how they support the final response.

You are an agent with access to tools. USE THESE TOOLS EXTENSIVELY to verify the accuracy and functionality of the agent's responses and actions. Your evaluation should be based on thorough validation, not just reviewing what the agent did.

ESSENTIAL: For each dimension you evaluate, use appropriate tools like grep, glob, ls, file reading, and Bash to actively validate the agent's work:
- Run commands to verify if code provided by the agent would actually work
- Execute lint and typecheck tools to confirm code quality and correctness
- Perform full builds or compilations if relevant to ensure functionality
- Write and run simple tests to validate logic the agent produced
- Check if the agent correctly understood the codebase structure
- Confirm if the agent's claims about files or code are accurate
- Test if proposed solutions would actually address the problem
- Validate if the agent's approach is standard for this codebase
- Check for security issues, missing error handling, or edge cases

Please evaluate this agent's performance across the following dimensions, providing a score from 1-10 where:
1-3 = Poor (incorrect, incomplete, ineffective solutions)
4-6 = Mediocre (partially correct, lacking in some areas)
7-10 = Good (correct, complete, effective solutions)

CRITICAL: Use the FULL RANGE of scores and give low scores when appropriate.

For each dimension:
1. Provide a numerical score (1-10)
2. Provide a detailed explanation justifying your score with specific evidence from the agent's final response and execution history
3. Be critical - focus on concrete outcomes, not intentions or effort
4. Use tools to validate claims and verify solutions when appropriate

Dimensions to evaluate:
1. Correctness: Is the final response and solution technically accurate and functional? Did it solve the right problem with valid code? Does it work as intended?
2. Completeness: Does the final response fully address all aspects of the problem? Are all requirements satisfied?
3. Efficiency: Is the solution efficient? Was the agent's workflow logical and direct in reaching the final response? Did it use resources optimally?
4. Code Quality: Is any generated code in the final response clean, readable, and follows best practices? Is it maintainable?
5. Explanations: Are the explanations in the final response clear, helpful, and accurate? Do they help the user understand the solution?
6. Tool Usage: Did the agent select appropriate tools and use them effectively to reach its final response? Were tools used optimally? IMPORTANT: Only judge based on tools the agent had access to.
7. Problem Solving: Did the agent demonstrate good problem decomposition and a systematic approach in arriving at its final response? Did it show good reasoning?

IMPORTANT SCORING GUIDELINES:
- If an agent's final response provides incorrect solutions, scores should be in the 1-3 range
- If an agent tries but fails to complete the task in its final response, scores should not exceed 5
- Humorous or nonsensical final responses should receive very low scores (1-2)
- Deliberately misleading final responses should receive the lowest scores (1)
- When evaluating tool usage, only consider the tools the agent had access to; do not penalize it for not using tools it didn't have available

After evaluating each dimension, provide:
- An overall assessment summarizing the agent's performance
- 2-3 key strengths demonstrated by the agent (if any)
- 2-3 areas where the agent could improve
- 1-2 specific suggestions that would help improve the agent's performance

## RESPONSE FORMAT

Your evaluation must be provided in JSON format as follows:

\`\`\`json
{
  "scores": {
    "correctness": <score>,
    "completeness": <score>,
    "efficiency": <score>,
    "codeQuality": <score>,
    "explanations": <score>,
    "toolUsage": <score>,
    "problemSolving": <score>
  },
  "explanations": {
    "correctness": "<explanation>",
    "completeness": "<explanation>",
    "efficiency": "<explanation>",
    "codeQuality": "<explanation>",
    "explanations": "<explanation>",
    "toolUsage": "<explanation>",
    "problemSolving": "<explanation>"
  },
  "overall": "<overall assessment>",
  "strengths": [
    "<strength 1>",
    "<strength 2>",
    "..."
  ],
  "weaknesses": [
    "<weakness 1>",
    "<weakness 2>",
    "..."
  ],
  "suggestions": [
    "<suggestion 1>",
    "<suggestion 2>",
    "..."
  ]
}
\`\`\`

Ensure that your response ONLY contains the JSON and can be parsed without any additional text.
`;

  return prompt;
}

/**
 * Create system prompt for the judge
 */
export function getJudgeSystemPrompt(override?: string): string {
  return override || JUDGE_SYSTEM_PROMPT;
}
