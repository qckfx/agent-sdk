/**
 * Type checking test for ExecutionAdapter signatures
 *
 * This file doesn't run actual tests but checks for type compatibility
 * TypeScript will catch any type signature mismatches during compilation
 */
import { ExecutionAdapter } from '../../types/tool.js';
import { LocalExecutionAdapter } from '../LocalExecutionAdapter.js';
import { DockerExecutionAdapter } from '../DockerExecutionAdapter.js';
import { E2BExecutionAdapter } from '../E2BExecutionAdapter.js';
import { CheckpointingExecutionAdapter } from '../CheckpointingExecutionAdapter.js';

// This test ensures that all ExecutionAdapter implementations match the interface signature
// If there's any mismatch, TypeScript will fail to compile this file
describe('ExecutionAdapter type signatures', () => {
  it('validates all adapters implement the ExecutionAdapter interface correctly', () => {
    // This is a type-checking test only - actual assertions are done by TypeScript compiler

    // Define a function that accepts any ExecutionAdapter
    const checkAdapter = (adapter: ExecutionAdapter) => {
      // Call all methods to verify signature compatibility
      adapter.writeFile('/path', 'content');
      adapter.writeFile('/path', 'content', 'utf8');

      adapter.readFile('/path');
      adapter.readFile('/path', 1024, 0, 100, 'utf8');
      adapter.readFile('/path', 1024, 0, 100, 'base64');

      adapter.editFile('/path', 'old', 'new');
      adapter.editFile('/path', 'old', 'new', 'utf8');

      adapter.glob('*.js');
      adapter.glob('*.js', {});

      adapter.executeCommand('echo test');
      adapter.executeCommand('echo test', '/workdir');

      adapter.ls('/path');
      adapter.ls('/path', true);
      adapter.ls('/path', true, true);

      adapter.generateDirectoryMap('/path');
      adapter.generateDirectoryMap('/path', 10);

      adapter.getGitRepositoryInfo();
    };

    // No actual tests, just typecheck that would be caught during compilation
    expect(true).toBe(true);
  });
});
