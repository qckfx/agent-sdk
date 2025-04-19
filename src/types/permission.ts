/**
 * Types and interfaces for permission management
 */

export interface UIHandler {
  requestPermission(toolId: string, args: Record<string, unknown>): Promise<boolean>;
}

export interface PermissionManagerConfig {
  uiHandler?: UIHandler;
  logger?: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  // Optional initial state for fast edit mode
  initialFastEditMode?: boolean;
  // DANGER_MODE: Auto-approve all tool operations (use only in sandbox environments)
  DANGER_MODE?: boolean;
}

export interface PermissionManager {
  requestPermission(toolId: string, args: Record<string, unknown>): Promise<boolean>;
  
  // Fast Edit Mode methods
  setFastEditMode(enabled: boolean): void;
  isFastEditMode(): boolean;
  
  // Method to check if a tool should require permission
  shouldRequirePermission(toolId: string): boolean;
  
  // DANGER_MODE methods - use only in secure environments
  enableDangerMode(): void;
  disableDangerMode(): void;
  isDangerModeEnabled(): boolean;
}