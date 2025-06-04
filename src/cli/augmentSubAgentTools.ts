/* eslint-disable jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import path from 'path';
import { resolveAgentConfigPath } from './pathResolvers.js';

// Default built-in tools as per schema defaults
export const DEFAULT_BUILTIN_TOOLS = [
  'bash',
  'glob',
  'grep',
  'ls',
  'file_read',
  'file_edit',
  'file_write',
  'think',
  'batch',
] as const;

type AgentConfig = Record<string, any>;

/**
 * Augment the agentConfig with sub-agent tools, preserving existing tools and enabling experimental subAgents
 * @param agentConfig - The agent configuration to augment
 * @param subAgentNames - Array of sub-agent names to add
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns void
 */
export function augmentAgentConfigWithSubAgents(
  agentConfig: AgentConfig,
  subAgentNames: string[],
  cwd = process.cwd(),
): void {
  // Ensure experimentalFeatures.subAgents is enabled
  if (!agentConfig.experimentalFeatures) {
    agentConfig.experimentalFeatures = { subAgents: true };
  } else {
    agentConfig.experimentalFeatures.subAgents = true;
  }

  // Build sub-agent entries
  const subAgentEntries = subAgentNames
    .filter(rawName => typeof rawName === 'string' && rawName.length)
    .map(rawName => {
      const isExplicit =
        rawName.endsWith('.json') || rawName.includes('/') || rawName.includes('\\');
      const name = isExplicit ? path.basename(rawName, '.json') : rawName;
      let configFile: string;
      if (isExplicit) {
        configFile = path.resolve(cwd, rawName);
      } else {
        // Use shared resolver so --with-subagent matches -a resolution logic
        configFile = resolveAgentConfigPath(rawName, cwd);
      }
      return { name, configFile } as const;
    });

  // Merge with existing tools
  if (!agentConfig.tools) {
    agentConfig.tools = [...DEFAULT_BUILTIN_TOOLS, ...subAgentEntries];
  } else {
    const merged: any[] = Array.isArray(agentConfig.tools) ? [...agentConfig.tools] : [];
    for (const entry of subAgentEntries) {
      const exists = merged.some(tool =>
        typeof tool === 'string'
          ? tool === entry.name
          : tool.name === entry.name && tool.configFile === entry.configFile,
      );
      if (!exists) merged.push(entry);
    }
    agentConfig.tools = merged;
  }
}
