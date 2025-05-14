/**
 * Represents the status of a tool execution
 */
export var ToolExecutionStatus;
(function (ToolExecutionStatus) {
    ToolExecutionStatus["PENDING"] = "pending";
    ToolExecutionStatus["RUNNING"] = "running";
    ToolExecutionStatus["AWAITING_PERMISSION"] = "awaiting-permission";
    ToolExecutionStatus["COMPLETED"] = "completed";
    ToolExecutionStatus["ERROR"] = "error";
    ToolExecutionStatus["ABORTED"] = "aborted";
})(ToolExecutionStatus || (ToolExecutionStatus = {}));
/**
 * Events emitted by the ToolExecutionManager
 */
export var ToolExecutionEvent;
(function (ToolExecutionEvent) {
    ToolExecutionEvent["CREATED"] = "tool_execution:created";
    ToolExecutionEvent["UPDATED"] = "tool_execution:updated";
    ToolExecutionEvent["COMPLETED"] = "tool_execution:completed";
    ToolExecutionEvent["ERROR"] = "tool_execution:error";
    ToolExecutionEvent["ABORTED"] = "tool_execution:aborted";
    ToolExecutionEvent["PERMISSION_REQUESTED"] = "tool_execution:permission_requested";
    ToolExecutionEvent["PERMISSION_RESOLVED"] = "tool_execution:permission_resolved";
})(ToolExecutionEvent || (ToolExecutionEvent = {}));
//# sourceMappingURL=index.js.map