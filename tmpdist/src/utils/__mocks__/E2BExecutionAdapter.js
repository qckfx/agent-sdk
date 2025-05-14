export class E2BExecutionAdapter {
    /**
     * Mock implementation
     */
    static async create() {
        return new E2BExecutionAdapter();
    }
    async readFile() {
        return {
            success: true,
            path: 'mockFile.txt',
            content: 'Mock file content',
            size: 18,
            encoding: 'utf8'
        };
    }
    async writeFile() {
        return Promise.resolve();
    }
    async executeCommand() {
        return { stdout: 'Mock output', stderr: '', exitCode: 0 };
    }
    async glob() {
        return ['mockFile1.txt', 'mockFile2.txt'];
    }
    async editFile() {
        return {
            success: true,
            path: 'mockFile.txt',
            originalContent: 'Original content',
            newContent: 'New content'
        };
    }
    async ls() {
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
    async generateDirectoryMap(rootPath, maxDepth = 10) {
        return `<context name="directoryStructure">Below is a snapshot of this project's file structure at the start of the conversation. This snapshot will NOT update during the conversation. It skips over .gitignore patterns.

- ${rootPath}/
  - mockDir/
    - mockFile.txt
  - mockFile2.txt
</context>`;
    }
    async getGitRepositoryInfo() {
        // Mock git repository information with dirty status
        return {
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
        };
    }
}
//# sourceMappingURL=E2BExecutionAdapter.js.map