/**
 * Finite‑state machine for agent execution flow.
 * Pure reducer – no side‑effects – so it is easy to unit‑test.
 * @internal
 */
/** @internal */
export function transition(state, event) {
    switch (state.type) {
        case 'IDLE':
            if (event.type === 'USER_MESSAGE')
                return { type: 'WAITING_FOR_MODEL' };
            break;
        case 'WAITING_FOR_MODEL':
            if (event.type === 'MODEL_TOOL_CALL') {
                return { type: 'WAITING_FOR_TOOL_RESULT', toolUseId: event.toolUseId };
            }
            if (event.type === 'MODEL_FINAL')
                return { type: 'COMPLETE' };
            break;
        case 'WAITING_FOR_TOOL_RESULT':
            if (event.type === 'TOOL_FINISHED')
                return { type: 'WAITING_FOR_MODEL_FINAL' };
            break;
        case 'WAITING_FOR_MODEL_FINAL':
            if (event.type === 'MODEL_TOOL_CALL') {
                // model decided to call another tool – loop back
                return { type: 'WAITING_FOR_TOOL_RESULT', toolUseId: event.toolUseId };
            }
            if (event.type === 'MODEL_FINAL')
                return { type: 'COMPLETE' };
            break;
        case 'ABORTED':
            // Terminal
            return state;
        case 'COMPLETE':
            // Terminal
            return state;
    }
    if (event.type === 'ABORT_REQUESTED') {
        return { type: 'ABORTED' };
    }
    throw new Error(`Invalid transition: ${state.type} + ${event.type}`);
}
/** @internal */
export function isTerminal(state) {
    return state.type === 'COMPLETE' || state.type === 'ABORTED';
}
//# sourceMappingURL=AgentFSM.js.map