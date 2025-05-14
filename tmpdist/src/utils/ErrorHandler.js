/**
 * ErrorHandler - Provides consistent error handling functionality
 */
import { ErrorType } from '../types/error.js';
/**
 * Creates a custom error with additional properties
 * @param message - Error message
 * @param type - Error type from ErrorType
 * @param details - Additional error details
 * @returns The custom error
 */
export const createError = (message, type = ErrorType.UNKNOWN, details = {}) => {
    const error = new Error(message);
    error.type = type;
    error.details = details;
    return error;
};
/**
 * Creates an error handler
 * @param config - Error handler configuration
 * @returns The error handler interface
 */
export const createErrorHandler = (config = {}) => {
    const logger = config.logger || console;
    return {
        /**
         * Handle an error
         * @param error - The error to handle
         * @param context - Context where the error occurred
         * @returns Standardized error response
         */
        handleError(error, context = '') {
            // Log the error
            logger.error(`Error in ${context}: ${error.message}`, error);
            // Determine error type
            const customError = error;
            const errorType = customError.type || ErrorType.UNKNOWN;
            // Create standardized response
            return {
                success: false,
                error: {
                    message: error.message,
                    type: errorType,
                    context,
                    details: customError.details || {}
                }
            };
        },
        /**
         * Create and handle an error in one step
         * @param message - Error message
         * @param type - Error type
         * @param details - Additional error details
         * @param context - Context where the error occurred
         * @returns Standardized error response
         */
        error(message, type = ErrorType.UNKNOWN, details = {}, context = '') {
            const error = createError(message, type, details);
            return this.handleError(error, context);
        },
        /**
         * Create a validation error
         * @param message - Error message
         * @param details - Validation details
         * @returns Validation error
         */
        validationError(message, details = {}) {
            return createError(message, ErrorType.VALIDATION, details);
        },
        /**
         * Create a permission error
         * @param message - Error message
         * @param details - Permission details
         * @returns Permission error
         */
        permissionError(message, details = {}) {
            return createError(message, ErrorType.PERMISSION, details);
        },
        /**
         * Create a tool not found error
         * @param toolId - ID of the tool that wasn't found
         * @returns Tool not found error
         */
        toolNotFoundError(toolId) {
            return createError(`Tool not found: ${toolId}`, ErrorType.TOOL_NOT_FOUND, { toolId });
        }
    };
};
//# sourceMappingURL=ErrorHandler.js.map