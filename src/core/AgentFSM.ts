/**
 * Finite‑state machine for agent execution flow.
 * Pure reducer – no side‑effects – so it is easy to unit‑test.
 */

export type AgentState =
  | { type: 'IDLE' }
  | { type: 'WAITING_FOR_MODEL' }
  | { type: 'WAITING_FOR_TOOL_RESULT'; toolUseId: string }
  | { type: 'WAITING_FOR_MODEL_FINAL' }
  | { type: 'ABORTED' }
  | { type: 'COMPLETE' };

export type AgentEvent =
  | { type: 'USER_MESSAGE' }
  | { type: 'MODEL_TOOL_CALL'; toolUseId: string }
  | { type: 'TOOL_FINISHED' }
  | { type: 'MODEL_FINAL' }
  | { type: 'ABORT_REQUESTED' };

export function transition(state: AgentState, event: AgentEvent): AgentState {
  switch (state.type) {
    case 'IDLE':
      if (event.type === 'USER_MESSAGE') return { type: 'WAITING_FOR_MODEL' };
      break;

    case 'WAITING_FOR_MODEL':
      if (event.type === 'MODEL_TOOL_CALL') {
        return { type: 'WAITING_FOR_TOOL_RESULT', toolUseId: event.toolUseId };
      }
      if (event.type === 'MODEL_FINAL') return { type: 'COMPLETE' };
      break;

    case 'WAITING_FOR_TOOL_RESULT':
      if (event.type === 'TOOL_FINISHED') return { type: 'WAITING_FOR_MODEL_FINAL' };
      break;

    case 'WAITING_FOR_MODEL_FINAL':
      if (event.type === 'MODEL_TOOL_CALL') {
        // model decided to call another tool – loop back
        return { type: 'WAITING_FOR_TOOL_RESULT', toolUseId: event.toolUseId };
      }
      if (event.type === 'MODEL_FINAL') return { type: 'COMPLETE' };
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

export function isTerminal(state: AgentState): boolean {
  return state.type === 'COMPLETE' || state.type === 'ABORTED';
}
