/**
 * PermissionManager - Handles permission requests for tools that require user approval
 * @internal
 */
import { ToolCategory } from '../types/tool.js';
import { LogCategory } from '../utils/logger.js';
/**
 * Creates a permission manager to handle tool permission requests
 * @param toolRegistry - The tool registry to use for tool lookups
 * @param config - Configuration options
 * @returns The permission manager interface
 * @internal
 */
const createPermissionManager = (toolRegistry, config = {}) => {
    const logger = config.logger;
    // Fast Edit Mode state - when enabled, file operations don't require permission
    let fastEditMode = config.initialFastEditMode || false;
    // DANGER_MODE - when enabled, all tools are auto-approved (use only in sandbox environments)
    let dangerMode = config.DANGER_MODE || false;
    // UI handler for requesting permissions
    const uiHandler = config.uiHandler || {
        async requestPermission(toolId, args) {
            // Default implementation could be console-based
            logger?.info(`Tool ${toolId} wants to execute with args:`, LogCategory.PERMISSIONS, args);
            return true; // Always grant in default implementation
        }
    };
    return {
        /**
         * Request permission for a tool
         * @param toolId - The ID of the tool requesting permission
         * @param args - The arguments the tool will use
         * @returns Whether permission was granted
         */
        async requestPermission(toolId, args) {
            // Debug logging for all permission requests
            logger?.info(`Permission request for tool: ${toolId}`, LogCategory.PERMISSIONS, {
                toolId,
                argsKeys: Object.keys(args),
                fastEditMode,
                dangerMode
            });
            // When DANGER_MODE is enabled, auto-approve everything
            if (dangerMode) {
                logger?.info(`DANGER_MODE enabled, auto-approving tool: ${toolId}`, LogCategory.PERMISSIONS);
                return true;
            }
            const tool = toolRegistry.getTool(toolId);
            // Log tool info
            if (tool) {
                logger?.info(`Tool info for ${toolId}:`, LogCategory.PERMISSIONS, {
                    requiresPermission: tool.requiresPermission,
                    alwaysRequirePermission: tool.alwaysRequirePermission,
                    category: tool.category
                });
            }
            else {
                logger?.warn(`Unknown tool ${toolId} requesting permission`, LogCategory.PERMISSIONS);
            }
            // Handle unknown tools - require permission by default
            if (!tool) {
                logger?.info(`Unknown tool ${toolId}, requesting permission from user`, LogCategory.PERMISSIONS);
                return await uiHandler.requestPermission(toolId, args);
            }
            // If tool always requires permission, always prompt regardless of mode
            if (tool.alwaysRequirePermission) {
                logger?.info(`Tool ${toolId} has alwaysRequirePermission=true, requesting permission`, LogCategory.PERMISSIONS);
                return await uiHandler.requestPermission(toolId, args);
            }
            // If we're in fast edit mode and this is a file operation, auto-approve
            if (fastEditMode && toolRegistry.isToolInCategory(toolId, ToolCategory.FILE_OPERATION)) {
                logger?.info(`Fast Edit Mode enabled, auto-approving file operation: ${toolId}`, LogCategory.PERMISSIONS);
                return true;
            }
            // If the tool doesn't require permission, auto-approve
            if (!tool.requiresPermission) {
                logger?.info(`Tool ${toolId} has requiresPermission=false, auto-approving`, LogCategory.PERMISSIONS);
                return true;
            }
            // Otherwise, request permission normally
            logger?.info(`Requesting user permission for tool: ${toolId}`, LogCategory.PERMISSIONS);
            const granted = await uiHandler.requestPermission(toolId, args);
            // Log the permission decision
            if (granted) {
                logger?.info(`Permission granted for tool: ${toolId}`, LogCategory.PERMISSIONS);
            }
            else {
                logger?.info(`Permission denied for tool: ${toolId}`, LogCategory.PERMISSIONS);
            }
            return granted;
        },
        /**
         * Set the fast edit mode
         * @param enabled - Whether fast edit mode should be enabled
         */
        setFastEditMode(enabled) {
            fastEditMode = enabled;
            logger?.info(`Fast Edit Mode ${enabled ? 'enabled' : 'disabled'}`, LogCategory.PERMISSIONS);
        },
        /**
         * Check if fast edit mode is enabled
         * @returns Whether fast edit mode is enabled
         */
        isFastEditMode() {
            return fastEditMode;
        },
        /**
         * Check if a tool should require permission based on its category and current mode
         * @param toolId - The ID of the tool to check
         * @returns Whether the tool should require permission
         */
        shouldRequirePermission(toolId) {
            // When DANGER_MODE is enabled, no tools require permission
            if (dangerMode) {
                return false;
            }
            const tool = toolRegistry.getTool(toolId);
            // If we don't know the tool, require permission by default
            if (!tool) {
                return true;
            }
            // If the tool doesn't require permission at all, return false
            if (!tool.requiresPermission) {
                return false;
            }
            // Tools that always require permission, regardless of mode
            if (tool.alwaysRequirePermission) {
                return true;
            }
            // In fast edit mode, don't require permission for file operations
            if (fastEditMode && toolRegistry.isToolInCategory(toolId, ToolCategory.FILE_OPERATION)) {
                return false;
            }
            // Default to the tool's own requiresPermission value
            return tool.requiresPermission;
        },
        /**
         * Enable DANGER_MODE - auto-approves all tool operations
         * ONLY use this in secure sandbox environments
         */
        enableDangerMode() {
            dangerMode = true;
            logger?.warn('DANGER_MODE enabled - all tools will be auto-approved', LogCategory.PERMISSIONS);
        },
        /**
         * Disable DANGER_MODE
         */
        disableDangerMode() {
            dangerMode = false;
            logger?.info('DANGER_MODE disabled', LogCategory.PERMISSIONS);
        },
        /**
         * Check if DANGER_MODE is enabled
         * @returns Whether DANGER_MODE is enabled
         */
        isDangerModeEnabled() {
            return dangerMode;
        }
    };
};
// Export for internals barrel
export { createPermissionManager };
//# sourceMappingURL=PermissionManager.js.map