/**
 * Centralized task lifecycle states and the ONLY legal transitions.
 * Source of truth: APP_FLOW.md §15. Do not scatter status strings elsewhere.
 */

import { TERMINAL_TASK_STATES } from "@ai-harness/contracts";

export const TASK_STATES_LIST = [
  "QUEUED",
  "INITIALIZING",
  "UNDERSTANDING",
  "GATHERING_CONTEXT",
  "PLANNING",
  "WAITING_FOR_APPROVAL",
  "EXECUTING",
  "WAITING_FOR_TOOL_APPROVAL",
  "OBSERVING",
  "REPLANNING",
  "VERIFYING",
  "REVIEWING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
] as const;

export type TaskState = (typeof TASK_STATES_LIST)[number];

export const TERMINAL_STATES: readonly TaskState[] = TERMINAL_TASK_STATES;
export const NON_TERMINAL_STATES: readonly TaskState[] = TASK_STATES_LIST.filter(
  (s): s is TaskState => !TERMINAL_STATES.includes(s),
);

/** Legal edges exactly per APP_FLOW.md §15. */
export const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  QUEUED: ["INITIALIZING", "CANCELLED"],
  INITIALIZING: ["UNDERSTANDING", "FAILED", "CANCELLED"],
  UNDERSTANDING: ["GATHERING_CONTEXT", "FAILED", "CANCELLED"],
  GATHERING_CONTEXT: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: [
    "WAITING_FOR_APPROVAL",
    "EXECUTING",
    "FAILED",
    "CANCELLED",
  ],
  WAITING_FOR_APPROVAL: ["PLANNING", "EXECUTING", "CANCELLED"],
  EXECUTING: [
    "WAITING_FOR_TOOL_APPROVAL",
    "OBSERVING",
    "REPLANNING",
    "VERIFYING",
    "FAILED",
    "CANCELLED",
    "INTERRUPTED",
  ],
  WAITING_FOR_TOOL_APPROVAL: ["EXECUTING", "REPLANNING", "FAILED", "CANCELLED"],
  OBSERVING: ["EXECUTING", "REPLANNING", "VERIFYING", "FAILED", "CANCELLED"],
  REPLANNING: ["EXECUTING", "WAITING_FOR_APPROVAL", "FAILED", "CANCELLED"],
  VERIFYING: ["REVIEWING", "COMPLETED", "FAILED", "CANCELLED"],
  REVIEWING: ["COMPLETED", "FAILED", "CANCELLED"],
  INTERRUPTED: ["QUEUED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isActiveRunState(state: TaskState): boolean {
  return (
    !isTerminalState(state) &&
    state !== "INTERRUPTED" &&
    state !== "QUEUED"
  );
}

/**
 * Pure transition validation. The Agent Runtime persists a transition only
 * after this function accepts it — invalid transitions throw.
 */
export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_STATE_TRANSITION: ${from} -> ${to}`);
  }
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}
