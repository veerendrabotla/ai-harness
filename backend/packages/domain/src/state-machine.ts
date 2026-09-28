/**
 * Explicit state-transition definitions backed by XState 5 (TECH_STACK.md).
 * The machine below is GENERATED from TRANSITIONS so there is exactly one
 * source of truth; validation reads the machine's own configuration rather
 * than the actor runtime (v5's static .transition() is unreliable for
 * string-seeded snapshots).
 */

import { createMachine } from "xstate";
import { TASK_STATES_LIST, TRANSITIONS, type TaskState } from "./task-state.js";
import { AppError } from "@ai-harness/shared";

function edgeEventName(from: TaskState, to: TaskState): string {
  return `${from}__${to}`;
}

const statesConfig = Object.fromEntries(
  TASK_STATES_LIST.map((state) => [
    state,
    {
      on: Object.fromEntries(
        (TRANSITIONS[state] ?? []).map((target) => [edgeEventName(state, target), target]),
      ),
    },
  ]),
);

export const taskStateMachine = createMachine({
  id: "taskLifecycle",
  initial: "QUEUED" as TaskState,
  states: statesConfig,
});

type StateNodeConfigLike = { on?: Record<string, unknown> };

/** Resolve a transition against the XState-generated edge table. Throws CONFLICT on illegal edges. */
export function resolveTransition(from: TaskState, to: TaskState): TaskState {
  const states = taskStateMachine.config.states as Record<string, StateNodeConfigLike>;
  const event = states[from]?.on?.[edgeEventName(from, to)];
  if (event !== to) {
    throw new AppError("CONFLICT", `Invalid state transition: ${from} -> ${to}`, { from, to });
  }
  return to;
}

/** Exposed for parity tests: the machine-derived edge table. */
export function machineEdges(): Array<[TaskState, TaskState]> {
  const states = taskStateMachine.config.states as Record<string, StateNodeConfigLike>;
  const out: Array<[TaskState, TaskState]> = [];
  for (const [state, node] of Object.entries(states)) {
    for (const eventName of Object.keys(node.on ?? {})) {
      const target = eventName.split("__")[1];
      out.push([state as TaskState, target as TaskState]);
    }
  }
  return out;
}
