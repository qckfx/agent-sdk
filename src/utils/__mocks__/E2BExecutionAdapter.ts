/**
 * Mock implementation of E2BExecutionAdapter
 */
import { ExecutionAdapter } from '../../types/tool.js';
import { LSToolErrorResult, LSToolSuccessResult } from '../../tools/LSTool.js';
import { FileReadToolErrorResult, FileReadToolSuccessResult } from '../../tools/FileReadTool.js';
import { FileEditToolErrorResult, FileEditToolSuccessResult } from '../../tools/FileEditTool.js';
import { GitRepositoryInfo } from '../../types/repository.js';

export class E2BExecutionAdapter implements ExecutionAdapter {
  /**
   * Mock implementation
   */
  public static async create(): Promise<E2BExecutionAdapter> {
    return new E2BExecutionAdapter();
  }

  async readFile(): Promise<FileReadToolSuccessResult | FileReadToolErrorResult> {
    return {
      success: true,
      path: 'mockFile.txt',
      content: 'Mock file content',
      size: 18,
      encoding: 'utf8'
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
  
  async editFile(): Promise<FileEditToolSuccessResult | FileEditToolErrorResult> {
    return {
      success: true,
      path: 'mockFile.txt',
      originalContent: 'Original content',
      newContent: 'New content'
    };
  }

  async ls(): Promise<LSToolSuccessResult | LSToolErrorResult> {
    return {    
      success: true,
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
    // Mock git repository information with dirty status
    return [{
      repoRoot: '/home/user/projects/mock-repo',
      isGitRepository: true,
      currentBranch: 'feature/e2b-mock-branch',
      defaultBranch: 'main',
      status: {
        type: 'dirty',
        modifiedFiles: ['src/utils/mockFile.ts'],
        stagedFiles: ['src/components/mockComponent.tsx'],
        untrackedFiles: ['src/utils/newFile.ts'],
        deletedFiles: []
      },
      recentCommits: [
        'abc1234 Mock commit 1',
        'def5678 Mock commit 2',
        'ghi9012 Mock commit 3'
      ]
    }];
  }

  async getDirectoryStructures(): Promise<Map<string, string>> {
    return new Map([
      ['/home/user/projects/mock-repo', `- src/
  - utils/
    - mockFile.ts
  - components/
    - mockComponent.tsx
- package.json`]
    ]);
  }
}