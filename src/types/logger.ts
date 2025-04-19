/**
 * Logger interface and type definitions
 */

/**
 * Log levels in order of increasing verbosity
 */
export enum LogLevel {
  SILENT = 'silent',
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

/**
 * Log categories for better filtering
 */
export enum LogCategory {
  SYSTEM = 'system',
  TOOLS = 'tools',
  MODEL = 'model',
  PERMISSIONS = 'permissions',
  USER_INTERACTION = 'user',
  UI = 'ui',
  STATIC = 'static',
  SESSION = 'session',
  AGENT = 'agent'
}

/**
 * Configuration options for a logger
 */
export interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
  silent?: boolean;
  formatOptions?: {
    showTimestamp?: boolean;
    showPrefix?: boolean;
    colors?: boolean;
  };
  /**
   * Categories to include in logs (if not specified, all categories are included)
   */
  enabledCategories?: LogCategory[];
}

/**
 * Logger interface
 */
export interface Logger {
  debug: (message: string, category?: LogCategory | string, data?: unknown) => void;
  info: (message: string, category?: LogCategory | string, data?: unknown) => void;
  warn: (message: string, category?: LogCategory | string, data?: unknown) => void;
  error: (message: string, category?: LogCategory | string | Error, data?: unknown) => void;
}

