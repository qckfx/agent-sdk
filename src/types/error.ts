/**
 * Error types and interfaces for the error handling system
 */

export enum ErrorType {
  VALIDATION = 'validation_error',
  PERMISSION = 'permission_error',
  EXECUTION = 'execution_error',
  TOOL_NOT_FOUND = 'tool_not_found',
  MODEL = 'model_error',
  UNKNOWN = 'unknown_error'
}

export interface CustomError extends Error {
  type: ErrorType;
  details: Record<string, unknown>;
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
    type: ErrorType;
    context: string;
    details: Record<string, unknown>;
  };
}

export interface ErrorHandlerConfig {
  logger?: {
    error: (message: string, error?: Error | unknown) => void;
  };
}

export interface ErrorHandler {
  handleError(error: Error | CustomError, context?: string): ErrorResponse;
  error(message: string, type?: ErrorType, details?: Record<string, unknown>, context?: string): ErrorResponse;
  validationError(message: string, details?: Record<string, unknown>): CustomError;
  permissionError(message: string, details?: Record<string, unknown>): CustomError;
  toolNotFoundError(toolId: string): CustomError;
}