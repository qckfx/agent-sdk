/**
 * SubAgentTool – exposes another agent (defined in a separate JSON config) as
 * a callable tool.  When the tool is executed the incoming `query` parameter
 * is forwarded to the nested agent’s `processQuery` method and the agent’s
 * response is returned.
 */
import fs from 'fs';
import path from 'path';
import { createTool } from './createTool.js';
import { Agent } from '../Agent.js';
import { validateConfig } from '../utils/configValidator.js';
/**
 * Create a Tool wrapper around a sub-agent definition.
 *
 * @param ref            Object from the parent config `{ name, configFile }`.
 */
export async function createSubAgentTool(ref, getRemoteId) {
    if (!ref?.name || !ref?.configFile) {
        throw new Error('createSubAgentTool requires both "name" and "configFile"');
    }
    console.info('Creating sub-agent tool with ref:', JSON.stringify(ref, null, 2));
    const resolvedConfigPath = path.resolve(process.cwd(), ref.configFile);
    const raw = await fs.promises.readFile(resolvedConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    // Memoised nested agent instance.
    let nestedAgent = null;
    async function getNestedAgent() {
        if (nestedAgent)
            return nestedAgent;
        // Validate config; this throws if the JSON is invalid.
        const cfg = validateConfig(parsed);
        if (getRemoteId) {
            nestedAgent = await Agent.create(cfg, { getRemoteId });
        }
        else {
            nestedAgent = await Agent.create(cfg);
        }
        return nestedAgent;
    }
    return createTool({
        id: ref.name,
        name: ref.name,
        description: parsed.description ?? `Sub-agent defined in ${ref.configFile}`,
        parameters: {
            query: {
                type: 'string',
                description: 'Natural language query forwarded to the sub-agent',
            },
        },
        requiredParameters: ['query'],
        async execute(args) {
            console.info('Executing sub-agent tool with args:', args);
            const { query } = args;
            if (typeof query !== 'string' || !query.length) {
                throw new Error('Parameter "query" must be a non-empty string');
            }
            const agent = await getNestedAgent();
            console.info('Executing sub-agent with args:', args);
            return agent.processQuery(query);
        },
    });
}
//# sourceMappingURL=SubAgentTool.js.map