/**
 * Logger interface and type definitions
 */
/**
 * Log levels in order of increasing verbosity
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel["SILENT"] = "silent";
    LogLevel["ERROR"] = "error";
    LogLevel["WARN"] = "warn";
    LogLevel["INFO"] = "info";
    LogLevel["DEBUG"] = "debug";
})(LogLevel || (LogLevel = {}));
/**
 * Log categories for better filtering
 */
export var LogCategory;
(function (LogCategory) {
    LogCategory["SYSTEM"] = "system";
    LogCategory["TOOLS"] = "tools";
    LogCategory["MODEL"] = "model";
    LogCategory["PERMISSIONS"] = "permissions";
    LogCategory["USER_INTERACTION"] = "user";
    LogCategory["UI"] = "ui";
    LogCategory["STATIC"] = "static";
    LogCategory["SESSION"] = "session";
    LogCategory["AGENT"] = "agent";
})(LogCategory || (LogCategory = {}));
//# sourceMappingURL=logger.js.map