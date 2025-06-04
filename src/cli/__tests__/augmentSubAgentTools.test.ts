import path from 'path';
import { augmentAgentConfigWithSubAgents, DEFAULT_BUILTIN_TOOLS } from '../augmentSubAgentTools';

describe('augmentAgentConfigWithSubAgents', () => {
  const cwd = process.cwd();

  it('should add default tools and sub-agent entry when no tools present', () => {
    const config: any = {};
    augmentAgentConfigWithSubAgents(config, ['prompt-editor'], cwd);

    // experimentalFeatures should be enabled
    expect(config.experimentalFeatures).toEqual({ subAgents: true });

    // tools should include defaults and sub-agent
    const tools = config.tools;
    expect(Array.isArray(tools)).toBe(true);
    // Check defaults
    DEFAULT_BUILTIN_TOOLS.forEach(tool => {
      expect(tools).toContain(tool);
    });

    // Check sub-agent entry
    const entry = tools.find((t: any) => typeof t === 'object' && t.name === 'prompt-editor');
    expect(entry).toBeDefined();
    expect(entry.configFile).toBe(path.resolve(cwd, '.qckfx', 'prompt-editor.json'));
  });

  it('should merge with existing default tools and avoid duplicates', () => {
    const initialTools = [...DEFAULT_BUILTIN_TOOLS];
    const config: any = { tools: initialTools.slice() };

    augmentAgentConfigWithSubAgents(config, ['prompt-editor', 'bash'], cwd);

    // tools count should be initial defaults + 1 (prompt-editor), bash duplicate ignored
    const tools = config.tools;
    const defaultCount = DEFAULT_BUILTIN_TOOLS.length;
    expect(tools.length).toBe(defaultCount + 1);

    // bash should appear only once
    expect(tools.filter((t: any) => t === 'bash').length).toBe(1);

    // prompt-editor entry exists
    const entry = tools.find((t: any) => typeof t === 'object' && t.name === 'prompt-editor');
    expect(entry).toBeDefined();
  });

  it('should resolve explicit json path correctly', () => {
    const config: any = {};
    const explicit = 'my-agent.json';
    augmentAgentConfigWithSubAgents(config, [explicit], cwd);
    const entry = config.tools.find((t: any) => t.name === explicit.replace(/\.json$/, ''));
    expect(entry).toBeDefined();
    expect(entry.configFile).toBe(path.resolve(cwd, explicit));
  });
});
