import { describe, expect, it } from "vitest";
import {
  TRANSITIONS,
  assertTransition,
  canTransition,
  isActiveRunState,
  isTerminalState,
  TASK_STATES_LIST,
  type TaskState,
} from "./task-state.js";
import { machineEdges, resolveTransition } from "./state-machine.js";

/** APP_FLOW.md §15 — every listed edge must be legal, nothing else. */
const EXPECTED_EDGES: Array<[TaskState, TaskState]> = [
  ["QUEUED", "INITIALIZING"],
  ["QUEUED", "CANCELLED"],
  ["INITIALIZING", "UNDERSTANDING"],
  ["INITIALIZING", "FAILED"],
  ["INITIALIZING", "CANCELLED"],
  ["UNDERSTANDING", "GATHERING_CONTEXT"],
  ["UNDERSTANDING", "FAILED"],
  ["UNDERSTANDING", "CANCELLED"],
  ["GATHERING_CONTEXT", "PLANNING"],
  ["GATHERING_CONTEXT", "FAILED"],
  ["GATHERING_CONTEXT", "CANCELLED"],
  ["PLANNING", "WAITING_FOR_APPROVAL"],
  ["PLANNING", "EXECUTING"],
  ["PLANNING", "FAILED"],
  ["PLANNING", "CANCELLED"],
  ["WAITING_FOR_APPROVAL", "PLANNING"],
  ["WAITING_FOR_APPROVAL", "EXECUTING"],
  ["WAITING_FOR_APPROVAL", "CANCELLED"],
  ["EXECUTING", "WAITING_FOR_TOOL_APPROVAL"],
  ["EXECUTING", "OBSERVING"],
  ["EXECUTING", "REPLANNING"],
  ["EXECUTING", "VERIFYING"],
  ["EXECUTING", "FAILED"],
  ["EXECUTING", "CANCELLED"],
  ["EXECUTING", "INTERRUPTED"],
  ["WAITING_FOR_TOOL_APPROVAL", "EXECUTING"],
  ["WAITING_FOR_TOOL_APPROVAL", "REPLANNING"],
  ["WAITING_FOR_TOOL_APPROVAL", "FAILED"],
  ["WAITING_FOR_TOOL_APPROVAL", "CANCELLED"],
  ["OBSERVING", "EXECUTING"],
  ["OBSERVING", "REPLANNING"],
  ["OBSERVING", "VERIFYING"],
  ["OBSERVING", "FAILED"],
  ["OBSERVING", "CANCELLED"],
  ["REPLANNING", "EXECUTING"],
  ["REPLANNING", "WAITING_FOR_APPROVAL"],
  ["REPLANNING", "FAILED"],
  ["REPLANNING", "CANCELLED"],
  ["VERIFYING", "REVIEWING"],
  ["VERIFYING", "COMPLETED"],
  ["VERIFYING", "FAILED"],
  ["VERIFYING", "CANCELLED"],
  ["REVIEWING", "COMPLETED"],
  ["REVIEWING", "FAILED"],
  ["REVIEWING", "CANCELLED"],
  ["INTERRUPTED", "QUEUED"],
  ["INTERRUPTED", "CANCELLED"],
];

describe("task state machine", () => {
  it("allows exactly the documented transitions", () => {
    for (const [from, to] of EXPECTED_EDGES) {
      expect(canTransition(from, to), `${from} -> ${to} should be legal`).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it("rejects undocumented transitions", () => {
    const illegal: Array<[TaskState, TaskState]> = [
      ["QUEUED", "EXECUTING"],
      ["COMPLETED", "EXECUTING"],
      ["FAILED", "QUEUED"],
      ["CANCELLED", "QUEUED"],
      ["VERIFYING", "EXECUTING"],
      ["WAITING_FOR_APPROVAL", "VERIFYING"],
      ["INTERRUPTED", "EXECUTING"],
      ["PLANNING", "COMPLETED"],
    ];
    for (const [from, to] of illegal) {
      if (!EXPECTED_EDGES.some(([f, t]) => f === from && t === to)) {
        expect(canTransition(from, to), `${from} -> ${to} should be ILLEGAL`).toBe(false);
        expect(() => resolveTransition(from, to)).toThrow(/Invalid state transition/);
      }
    }
  });

  it("classifies terminal and active states", () => {
    expect(isTerminalState("COMPLETED")).toBe(true);
    expect(isTerminalState("FAILED")).toBe(true);
    expect(isTerminalState("CANCELLED")).toBe(true);
    expect(isTerminalState("EXECUTING")).toBe(false);
    expect(isActiveRunState("EXECUTING")).toBe(true);
    expect(isActiveRunState("INTERRUPTED")).toBe(false); // resumable, not active
    expect(isActiveRunState("COMPLETED")).toBe(false);
  });

  it("keeps the XState machine in parity with TRANSITIONS (single source)", () => {
    // The XState-generated definition must contain EXACTLY the documented edges.
    const derived = machineEdges().map(([f, t]) => `${f}->${t}`).sort();
    const documented = EXPECTED_EDGES.map(([f, t]) => `${f}->${t}`).sort();
    expect(derived).toEqual(documented);
  });

  it("has no unreachable states", () => {
    const reachable = new Set<TaskState>(["QUEUED"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [from, targets] of Object.entries(TRANSITIONS)) {
        if (reachable.has(from as TaskState)) {
          for (const t of targets as TaskState[]) {
            if (!reachable.has(t)) {
              reachable.add(t);
              changed = true;
            }
          }
        }
      }
    }
    expect(reachable.size).toBe(TASK_STATES_LIST.length);
  });
});
