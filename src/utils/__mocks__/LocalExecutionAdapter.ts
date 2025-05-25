/**
 * Mock implementation of LocalExecutionAdapter
 */
import { ExecutionAdapter } from '../../types/tool.js';
import { LSToolResult } from '../../tools/LSTool.js';
import { FileReadToolResult } from '../../tools/FileReadTool.js';
import { FileEditToolResult } from '../../tools/FileEditTool.js';
import { GitRepositoryInfo } from '../../types/repository.js';

export class LocalExecutionAdapter implements ExecutionAdapter {
  /**
   * Mock implementation
   */
  public static async create(): Promise<LocalExecutionAdapter> {
    return new LocalExecutionAdapter();
  }

  async readFile(): Promise<FileReadToolResult> {
    return {
      ok: true as const,
      data: {
        path: 'mockFile.txt',
        content: 'Mock file content',
        size: 18,
        encoding: 'utf8'
      }
    };
  }

  async writeFile(): Promise<void> {
    return Promise.resolve();
  }
  
  async executeCommand() {
    return { stdout: 'Mock output', stderr: '', exitCode: 0 };
  }
  
  async glob() {
    return ['mockFile1.txt', 'mockFile2.txt'];
  }
  
  async editFile(): Promise<FileEditToolResult> {
    return {
      ok: true as const,
      data: {
        path: 'mockFile.txt',
        originalContent: 'Original content',
        newContent: 'New content'
      }
    };
  }

  async ls(): Promise<LSToolResult> {
    return {
      ok: true as const,
      data: {
        path: '/mock',
        entries: [
          {
            name: 'mockFile.txt',
            type: 'file',
            isDirectory: false,
            isFile: true,
            isSymbolicLink: false
          }
        ],
        count: 1
      }
    };
  }

  async generateDirectoryMap(rootPath: string, maxDepth: number = 10): Promise<string> {
    return `<context name="directoryStructure">Below is a snapshot of this project's file structure at the start of the conversation. This snapshot will NOT update during the conversation. It skips over .gitignore patterns.

- ${rootPath}/
  - mockDir/
    - mockFile.txt
  - mockFile2.txt
</context>`;
  }
  
  async getGitRepositoryInfo(): Promise<GitRepositoryInfo[]> {
    // Mock git repository information with clean status
    return [{
      repoRoot: '/Users/test/mock-repo',
      isGitRepository: true,
      currentBranch: 'feature/mock-branch',
      defaultBranch: 'main',
      status: { type: 'clean' },
      recentCommits: [
        'abc1234 Mock commit 1',
        'def5678 Mock commit 2',
        'ghi9012 Mock commit 3'
      ]
    }];
  }

  async getDirectoryStructures(): Promise<Map<string, string>> {
    return new Map([
      ['/Users/test/mock-repo', `- src/
  - utils/
    - mockFile.ts
  - components/
    - mockComponent.tsx
- package.json`]
    ]);
  }
}