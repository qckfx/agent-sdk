/**
 * Types and interfaces for permission management
 */

import type { Logger } from '../utils/logger.js';

export interface UIHandler {
  requestPermission(
    sessionId: string,
    toolId: string,
    args: Record<string, unknown>,
  ): Promise<boolean>;
}

export interface PermissionManagerConfig {
  uiHandler?: UIHandler;
  logger?: Logger;
  // Optional initial state for fast edit mode
  initialFastEditMode?: boolean;
  // DANGER_MODE: Auto-approve all tool operations (use only in sandbox environments)
  DANGER_MODE?: boolean;
}

export interface PermissionManager {
  requestPermission(
    sessionId: string,
    toolId: string,
    args: Record<string, unknown>,
  ): Promise<boolean>;

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
