import fs from 'fs';
import path from 'path';
import { AgentExecutionHistory, JudgmentResult } from '../models/types.js';
import { AgentConfiguration, ConfigurationComparison } from '../models/ab-types.js';
import { createLogger, LogLevel } from '../../utils/logger.js';

// Create a logger for storage operations
const logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'EvalStorage'
});

/**
 * File system interface for abstracting storage operations
 * This allows for easy mocking in tests
 */
export interface IFileSystem {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  writeFileSync(path: string, data: string, options: { encoding: BufferEncoding }): void;
  readFileSync(path: string, options: { encoding: BufferEncoding }): string;
  readdirSync(path: string): string[];
  statSync(path: string): { mtime: { getTime: () => number } };
  rmSync(path: string, options: { recursive: boolean, force: boolean }): void;
}

/**
 * Default file system implementation using Node's fs module
 */
export class NodeFileSystem implements IFileSystem {
  existsSync(path: string): boolean {
    return fs.existsSync(path);
  }

  mkdirSync(path: string, options: { recursive: boolean }): void {
    fs.mkdirSync(path, options);
  }

  writeFileSync(path: string, data: string, options: { encoding: BufferEncoding }): void {
    fs.writeFileSync(path, data, options);
  }

  readFileSync(path: string, options: { encoding: BufferEncoding }): string {
    return fs.readFileSync(path, options) as string;
  }

  readdirSync(path: string): string[] {
    return fs.readdirSync(path);
  }

  statSync(path: string): { mtime: { getTime: () => number } } {
    return fs.statSync(path);
  }

  rmSync(path: string, options: { recursive: boolean, force: boolean }): void {
    fs.rmSync(path, options);
  }
}

/**
 * Storage service for managing evaluation data
 */
export class StorageService {
  private fileSystem: IFileSystem;
  private baseDir: string;

  constructor(
    fileSystem: IFileSystem = new NodeFileSystem(),
    baseDir: string = path.resolve(process.cwd(), '.eval-data')
  ) {
    this.fileSystem = fileSystem;
    this.baseDir = baseDir;
  }

  /**
   * Ensures a directory exists, creating it if necessary
   */
  ensureDirectoryExists(dirPath: string): void {
    if (!this.fileSystem.existsSync(dirPath)) {
      this.fileSystem.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Generate a unique ID for storing data
   */
  generateUniqueId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Format a date for use in filenames
   */
  formatDateForFilename(date: Date = new Date()): string {
    return date.toISOString().replace(/:/g, '-').replace(/\./g, '-');
  }

  /**
   * Get the storage directory for a specific evaluation run
   */
  getEvaluationStorageDir(
    options: {
      runId?: string;
      testName?: string;
      createIfNotExist?: boolean;
    } = {}
  ): string {
    const { 
      runId = this.formatDateForFilename(), 
      testName, 
      createIfNotExist = true 
    } = options;
    
    const baseDir = path.join(this.baseDir, runId);
    const storageDir = testName ? path.join(baseDir, testName) : baseDir;
    
    if (createIfNotExist) {
      this.ensureDirectoryExists(storageDir);
    }
    
    return storageDir;
  }

  /**
   * Store an execution history to disk
   */
  storeExecutionHistory(
    executionHistory: AgentExecutionHistory,
    options: {
      runId?: string;
      testName?: string;
      executionId?: string;
    } = {}
  ): string {
    try {
      const { executionId = this.generateUniqueId() } = options;
      const storageDir = this.getEvaluationStorageDir(options);
      
      // Create histories directory
      const historiesDir = path.join(storageDir, 'histories');
      this.ensureDirectoryExists(historiesDir);
      
      // Write the execution history to a file
      const filePath = path.join(historiesDir, `history-${executionId}.json`);
      this.fileSystem.writeFileSync(
        filePath,
        JSON.stringify(executionHistory, null, 2),
        { encoding: 'utf8' }
      );
      
      logger.debug(`Stored execution history to ${filePath}`);
      return executionId;
    } catch (error) {
      logger.error('Failed to store execution history', error);
      throw error;
    }
  }

  /**
   * Load an execution history from disk
   */
  loadExecutionHistory(
    executionId: string,
    options: {
      runId?: string;
      testName?: string;
    } = {}
  ): AgentExecutionHistory | null {
    try {
      const storageDir = this.getEvaluationStorageDir({
        ...options,
        createIfNotExist: false,
      });
      
      const filePath = path.join(storageDir, 'histories', `history-${executionId}.json`);
      
      if (!this.fileSystem.existsSync(filePath)) {
        logger.warn(`Execution history not found: ${filePath}`);
        return null;
      }
      
      const historyData = this.fileSystem.readFileSync(filePath, { encoding: 'utf8' });
      return JSON.parse(historyData) as AgentExecutionHistory;
    } catch (error) {
      logger.error(`Failed to load execution history ${executionId}`, error);
      return null;
    }
  }

  /**
   * List all stored execution histories for a run or test
   */
  listExecutionHistories(
    options: {
      runId?: string;
      testName?: string;
    } = {}
  ): { id: string; path: string }[] {
    try {
      const storageDir = this.getEvaluationStorageDir({
        ...options,
        createIfNotExist: false,
      });
      
      const historiesDir = path.join(storageDir, 'histories');
      
      if (!this.fileSystem.existsSync(historiesDir)) {
        return [];
      }
      
      // Get all history files
      const files = this.fileSystem.readdirSync(historiesDir)
        .filter(file => file.startsWith('history-') && file.endsWith('.json'));
      
      // Extract IDs from filenames
      return files.map(file => {
        const id = file.replace('history-', '').replace('.json', '');
        return {
          id,
          path: path.join(historiesDir, file),
        };
      });
    } catch (error) {
      logger.error('Failed to list execution histories', error);
      return [];
    }
  }

  /**
   * Store a judgment result to disk
   */
  storeJudgmentResult(
    judgmentResult: JudgmentResult,
    executionId: string,
    options: {
      runId?: string;
      testName?: string;
      judgmentId?: string;
    } = {}
  ): string {
    try {
      const { judgmentId = this.generateUniqueId() } = options;
      const storageDir = this.getEvaluationStorageDir(options);
      
      // Create judgments directory
      const judgmentsDir = path.join(storageDir, 'judgments');
      this.ensureDirectoryExists(judgmentsDir);
      
      // Write the judgment result to a file
      const filePath = path.join(
        judgmentsDir,
        `judgment-${executionId}-${judgmentId}.json`
      );
      
      this.fileSystem.writeFileSync(
        filePath,
        JSON.stringify(judgmentResult, null, 2),
        { encoding: 'utf8' }
      );
      
      logger.debug(`Stored judgment result to ${filePath}`);
      return judgmentId;
    } catch (error) {
      logger.error('Failed to store judgment result', error);
      throw error;
    }
  }

  /**
   * Load a judgment result from disk
   */
  loadJudgmentResult(
    executionId: string,
    judgmentId: string,
    options: {
      runId?: string;
      testName?: string;
    } = {}
  ): JudgmentResult | null {
    try {
      const storageDir = this.getEvaluationStorageDir({
        ...options,
        createIfNotExist: false,
      });
      
      const filePath = path.join(
        storageDir,
        'judgments',
        `judgment-${executionId}-${judgmentId}.json`
      );
      
      if (!this.fileSystem.existsSync(filePath)) {
        logger.warn(`Judgment result not found: ${filePath}`);
        return null;
      }
      
      const judgmentData = this.fileSystem.readFileSync(filePath, { encoding: 'utf8' });
      return JSON.parse(judgmentData) as JudgmentResult;
    } catch (error) {
      logger.error(`Failed to load judgment result ${judgmentId}`, error);
      return null;
    }
  }

  /**
   * List all stored judgments for a specific execution or all executions
   */
  listJudgmentResults(
    options: {
      runId?: string;
      testName?: string;
      executionId?: string;
    } = {}
  ): { judgmentId: string; executionId: string; path: string }[] {
    try {
      const { executionId } = options;
      const storageDir = this.getEvaluationStorageDir({
        ...options,
        createIfNotExist: false,
      });
      
      const judgmentsDir = path.join(storageDir, 'judgments');
      
      if (!this.fileSystem.existsSync(judgmentsDir)) {
        return [];
      }
      
      // Get all judgment files
      let files = this.fileSystem.readdirSync(judgmentsDir)
        .filter(file => file.startsWith('judgment-') && file.endsWith('.json'));
      
      // Filter by executionId if provided
      if (executionId) {
        files = files.filter(file => file.includes(`-${executionId}-`));
      }
      
      // Extract IDs from filenames
      return files.map(file => {
        // Expected format: judgment-exec1-judge1.json
        // Remove 'judgment-' prefix and '.json' suffix
        const idPart = file.replace(/^judgment-/, '').replace(/\.json$/, '');
        
        // Find the position of the first hyphen after the execution ID
        const firstHyphenPos = idPart.indexOf('-');
        
        if (firstHyphenPos === -1) {
          // Malformed filename
          return {
            executionId: idPart,
            judgmentId: 'unknown',
            path: path.join(judgmentsDir, file)
          };
        }
        
        const currentExecutionId = idPart.substring(0, firstHyphenPos);
        const judgmentId = idPart.substring(firstHyphenPos + 1);
        
        return {
          judgmentId,
          executionId: currentExecutionId,
          path: path.join(judgmentsDir, file),
        };
      });
    } catch (error) {
      logger.error('Failed to list judgment results', error);
      return [];
    }
  }

  /**
   * Store a comparison result between two judgments
   */
  storeComparisonResult(
    comparisonText: string,
    executionIdA: string,
    executionIdB: string,
    options: {
      runId?: string;
      testName?: string;
      comparisonId?: string;
    } = {}
  ): string {
    try {
      const { comparisonId = this.generateUniqueId() } = options;
      const storageDir = this.getEvaluationStorageDir(options);
      
      // Create comparisons directory
      const comparisonsDir = path.join(storageDir, 'comparisons');
      this.ensureDirectoryExists(comparisonsDir);
      
      // Write the comparison result to a file
      const filePath = path.join(
        comparisonsDir,
        `comparison-${executionIdA}-${executionIdB}-${comparisonId}.md`
      );
      
      this.fileSystem.writeFileSync(filePath, comparisonText, { encoding: 'utf8' });
      
      logger.debug(`Stored comparison result to ${filePath}`);
      return comparisonId;
    } catch (error) {
      logger.error('Failed to store comparison result', error);
      throw error;
    }
  }

  /**
   * Clean up old evaluation data to save disk space
   */
  cleanupOldEvaluationData(
    options: {
      maxAgeDays?: number;
      preserveRuns?: string[];
    } = {}
  ): void {
    try {
      const { maxAgeDays = 7, preserveRuns = [] } = options;
      
      if (!this.fileSystem.existsSync(this.baseDir)) {
        return;
      }
      
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      
      // Get all run directories
      const runDirs = this.fileSystem.readdirSync(this.baseDir);
      
      for (const runDir of runDirs) {
        // Skip directories that should be preserved
        if (preserveRuns.includes(runDir)) {
          continue;
        }
        
        const runPath = path.join(this.baseDir, runDir);
        const stats = this.fileSystem.statSync(runPath);
        
        // Check if the directory is older than maxAgeDays
        if (now - stats.mtime.getTime() > maxAgeMs) {
          // Remove the directory and all its contents
          this.fileSystem.rmSync(runPath, { recursive: true, force: true });
          logger.info(`Cleaned up old evaluation data: ${runPath}`);
        }
      }
    } catch (error) {
      logger.error('Failed to clean up old evaluation data', error);
    }
  }

  /**
   * Store an agent configuration
   */
  storeConfiguration(
    config: AgentConfiguration,
    options: {
      runId?: string;
    } = {}
  ): void {
    try {
      const runId = options.runId || this.formatDateForFilename();
      const evalDir = this.getEvaluationStorageDir({ runId });
      const configsDir = path.join(evalDir, 'configurations');
      this.ensureDirectoryExists(configsDir);
      
      const filePath = path.join(configsDir, `config-${config.id}.json`);
      this.fileSystem.writeFileSync(
        filePath, 
        JSON.stringify(config, null, 2), 
        { encoding: 'utf8' }
      );
      
      logger.debug(`Stored configuration to ${filePath}`);
    } catch (error) {
      logger.error('Failed to store configuration', error);
    }
  }

  /**
   * Store a comparison between two configurations
   */
  storeConfigurationComparison(
    comparison: ConfigurationComparison,
    configAId: string,
    configBId: string,
    options: {
      runId?: string;
      comparisonId?: string;
    } = {}
  ): string {
    try {
      const { comparisonId = this.generateUniqueId() } = options;
      const runId = options.runId || this.formatDateForFilename();
      const evalDir = this.getEvaluationStorageDir({ runId });
      const comparisonsDir = path.join(evalDir, 'config-comparisons');
      this.ensureDirectoryExists(comparisonsDir);
      
      const filePath = path.join(
        comparisonsDir, 
        `config-comparison-${configAId}-${configBId}-${comparisonId}.json`
      );
      
      this.fileSystem.writeFileSync(
        filePath, 
        JSON.stringify(comparison, null, 2), 
        { encoding: 'utf8' }
      );
      
      logger.debug(`Stored configuration comparison to ${filePath}`);
      return comparisonId;
    } catch (error) {
      logger.error('Failed to store configuration comparison', error);
      throw error;
    }
  }
}