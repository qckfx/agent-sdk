/**
 * Logger implementation
 */

import { LogCategory, LogLevel, LoggerOptions } from '../types/logger.js';

// Re-export both as enums (values) and types
export { LogCategory, LogLevel };
export type { LoggerOptions };

/**
 * Logger class for application logging
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;
  private silent: boolean;
  private formatOptions: {
    showTimestamp: boolean;
    showPrefix: boolean;
    colors: boolean;
  };
  private enabledCategories?: LogCategory[];
  private contextInfo: Record<string, string> = {};

  constructor(options: LoggerOptions) {
    this.level = options.level;
    this.prefix = options.prefix || '';
    this.silent = options.silent || false;
    this.formatOptions = {
      showTimestamp: options.formatOptions?.showTimestamp ?? false,
      showPrefix: options.formatOptions?.showPrefix ?? true,
      colors: options.formatOptions?.colors ?? false,
    };
    this.enabledCategories = options.enabledCategories;
  }

  /**
   * Set context information for this logger
   * Useful for adding details like test ID, config name, etc.
   */
  setContext(context: Record<string, string>): void {
    this.contextInfo = { ...this.contextInfo, ...context };
  }

  /**
   * Format a log message with optional timestamp and styling
   */
  private format(level: string, message: string): string {
    const timestamp = this.formatOptions.showTimestamp ? `[${new Date().toISOString()}] ` : '';
    const prefix = this.formatOptions.showPrefix && this.prefix ? `${this.prefix} ` : '';

    // Add context information if available
    let contextStr = '';
    if (Object.keys(this.contextInfo).length > 0) {
      contextStr =
        Object.entries(this.contextInfo)
          .map(([key, value]) => `[${key}:${value}]`)
          .join(' ') + ' ';
    }

    return `${timestamp}${prefix}${contextStr}[${level}] ${message}`;
  }

  /**
   * Check if a given log level should be displayed based on the current logger level
   */
  private shouldLog(messageLevel: LogLevel, category?: LogCategory): boolean {
    // Check if silent or level is SILENT
    if (this.silent || this.level === LogLevel.SILENT) return false;

    // Check if category is enabled (if categories are specified)
    if (category && this.enabledCategories && this.enabledCategories.length > 0) {
      if (!this.enabledCategories.includes(category)) {
        return false;
      }
    }

    // Convert string enum to numeric values for comparison
    const levels = {
      [LogLevel.SILENT]: 0,
      [LogLevel.ERROR]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.INFO]: 3,
      [LogLevel.DEBUG]: 4,
    };

    // Only log if the message level is **less than or equal to** the configured level
    // (e.g. only ERROR messages when level is ERROR, ERROR + WARN when level is WARN, etc.)
    return levels[messageLevel] <= levels[this.level];
  }

  // Implementation for overloaded debug method
  debug(message: string, categoryOrArg?: LogCategory | unknown, ...args: unknown[]): void {
    let category = LogCategory.SYSTEM;
    let logArgs: unknown[] = [];

    if (categoryOrArg !== undefined) {
      if (Object.values(LogCategory).includes(categoryOrArg as LogCategory)) {
        category = categoryOrArg as LogCategory;
        logArgs = args;
      } else {
        logArgs = [categoryOrArg, ...args];
      }
    }

    if (this.shouldLog(LogLevel.DEBUG, category)) {
      const categoryPrefix = category ? `[${category}] ` : '';
      console.debug(this.format('DEBUG', `${categoryPrefix}${message}`), ...logArgs);
    }
  }

  // Implementation for overloaded info method
  info(message: string, categoryOrArg?: LogCategory | unknown, ...args: unknown[]): void {
    let category = LogCategory.SYSTEM;
    let logArgs: unknown[] = [];

    if (categoryOrArg !== undefined) {
      if (Object.values(LogCategory).includes(categoryOrArg as LogCategory)) {
        category = categoryOrArg as LogCategory;
        logArgs = args;
      } else {
        logArgs = [categoryOrArg, ...args];
      }
    }

    if (this.shouldLog(LogLevel.INFO, category)) {
      const categoryPrefix = category ? `[${category}] ` : '';
      console.info(this.format('INFO', `${categoryPrefix}${message}`), ...logArgs);
    }
  }

  // Implementation for overloaded warn method
  warn(message: string, categoryOrArg?: LogCategory | unknown, ...args: unknown[]): void {
    let category = LogCategory.SYSTEM;
    let logArgs: unknown[] = [];

    if (categoryOrArg !== undefined) {
      if (Object.values(LogCategory).includes(categoryOrArg as LogCategory)) {
        category = categoryOrArg as LogCategory;
        logArgs = args;
      } else {
        logArgs = [categoryOrArg, ...args];
      }
    }

    if (this.shouldLog(LogLevel.WARN, category)) {
      const categoryPrefix = category ? `[${category}] ` : '';
      console.warn(this.format('WARN', `${categoryPrefix}${message}`), ...logArgs);
    }
  }

  // Implementation for overloaded error method
  error(message: string, errorOrCategory?: unknown, categoryOrData?: unknown): void {
    let error: unknown | undefined;
    let category = LogCategory.SYSTEM;
    let data: unknown | undefined;

    if (errorOrCategory !== undefined) {
      if (
        Object.values(LogCategory).includes(errorOrCategory as LogCategory) &&
        categoryOrData === undefined
      ) {
        category = errorOrCategory as LogCategory;
      } else {
        error = errorOrCategory;
        if (categoryOrData !== undefined) {
          if (Object.values(LogCategory).includes(categoryOrData as LogCategory)) {
            category = categoryOrData as LogCategory;
          } else {
            data = categoryOrData;
          }
        }
      }
    }

    if (this.shouldLog(LogLevel.ERROR, category)) {
      const categoryPrefix = category ? `[${category}] ` : '';
      console.error(
        this.format('ERROR', `${categoryPrefix}${message} ${data ? JSON.stringify(data) : ''}`),
      );
      if (error && this.level === LogLevel.DEBUG) {
        console.error(error);
      }
    }
  }
}

/**
 * Creates a logger instance
 * @param options - Logger configuration options
 * @returns The logger instance
 */
export const createLogger = (options: LoggerOptions): Logger => {
  return new Logger(options);
};
