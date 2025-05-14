/**
 * Error types and interfaces for the error handling system
 */
export var ErrorType;
(function (ErrorType) {
    ErrorType["VALIDATION"] = "validation_error";
    ErrorType["PERMISSION"] = "permission_error";
    ErrorType["EXECUTION"] = "execution_error";
    ErrorType["TOOL_NOT_FOUND"] = "tool_not_found";
    ErrorType["MODEL"] = "model_error";
    ErrorType["UNKNOWN"] = "unknown_error";
})(ErrorType || (ErrorType = {}));
//# sourceMappingURL=error.js.map