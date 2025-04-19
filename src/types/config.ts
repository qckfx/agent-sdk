export interface LoggerConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  prefix?: string;
  silent?: boolean;
}

export interface PermissionConfig {
  allowedPaths?: string[];
  deniedPaths?: string[];
  allowShellCommands?: boolean;
  allowedCommands?: string[];
  deniedCommands?: string[];
}

export interface AgentConfig {
  logger?: LoggerConfig;
  permissions?: PermissionConfig;
}