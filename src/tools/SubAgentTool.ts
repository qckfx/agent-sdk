/**
 * SubAgentTool – exposes another agent (defined in a separate JSON config) as
 * a callable tool.  When the tool is executed the incoming `query` parameter
 * is forwarded to the nested agent’s `processQuery` method and the agent’s
 * response is returned.
 */

import fs from 'fs';
import path from 'path';

import { createTool } from './createTool.js';
import { Tool } from '../types/tool.js';
import { ToolResult } from '../types/tool-result.js';
import { Agent } from '../Agent.js';

export interface SubAgentReference {
  name: string;
  configFile: string;
}

/**
 * Create a Tool wrapper around a sub-agent definition.
 *
 * @param ref            Object from the parent config `{ name, configFile }`.
 */
import { Logger, LogCategory } from '../utils/logger.js';

export async function createSubAgentTool(
  ref: SubAgentReference,
  getRemoteId?: (sessionId: string) => Promise<string>,
  logger?: Logger,
): Promise<Tool> {
  if (!ref?.name || !ref?.configFile) {
    throw new Error('createSubAgentTool requires both "name" and "configFile"');
  }

  logger?.info('Creating sub-agent tool', LogCategory.TOOLS, ref);
  const resolvedConfigPath = path.resolve(process.cwd(), ref.configFile);

  const raw = await fs.promises.readFile(resolvedConfigPath, 'utf8');
  const parsed = JSON.parse(raw);

  // Memoised nested agent instance.
  let nestedAgent: Agent | null = null;

  async function getNestedAgent(): Promise<Agent> {
    if (nestedAgent) return nestedAgent;

    if (getRemoteId) {
      nestedAgent = await Agent.create({ config: parsed, callbacks: { getRemoteId } });
    } else {
      nestedAgent = await Agent.create({ config: parsed });
    }
    return nestedAgent;
  }

  return createTool({
    id: ref.name,
    name: ref.name,
    description:
      (parsed.description ?? `Sub-agent defined in ${ref.configFile}`) +
      '\n\nExample call:\n            { "query": "analyze the performance of this codebase" }',
    parameters: {
      query: {
        type: 'string',
        description: 'Natural language query forwarded to the sub-agent',
      },
    },
    requiredParameters: ['query'],
    async execute(args) {
      logger?.debug('Executing sub-agent tool', LogCategory.TOOLS, args);
      const { query } = args as { query: string };

      if (typeof query !== 'string' || !query.length) {
        throw new Error('Parameter "query" must be a non-empty string');
      }

      const agent = await getNestedAgent();
      logger?.debug('Executing sub-agent', LogCategory.TOOLS, args);
      const result = await agent.processQuery(query);
      return {
        ok: true,
        data: result.response || 'No response from sub-agent',
      };
    },
  });
}
