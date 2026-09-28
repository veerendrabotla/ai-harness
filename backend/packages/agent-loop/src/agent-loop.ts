import { randomUUID } from "node:crypto";
import type {
  LoopConfig,
  LoopState,
  LoopResult,
  LoopPhase,
  Observation,
  LoopError,
  ToolCall,
  ToolResult,
  StuckDetection,
  FailureType,
} from "./types.js";
import { DEFAULT_LOOP_CONFIG } from "./types.js";

export class AgentLoop {
  private config: LoopConfig;
  private state: LoopState;
  private phaseHistory: Array<{ phase: LoopPhase; timestamp: Date }> = [];
  private onPhaseChange?: (phase: LoopPhase, state: LoopState) => void;
  private onToolCall?: (call: ToolCall) => Promise<ToolResult>;
  private onObservation?: (obs: Observation) => void;

  constructor(
    config?: Partial<LoopConfig>,
    handlers?: {
      onPhaseChange?: (phase: LoopPhase, state: LoopState) => void;
      onToolCall?: (call: ToolCall) => Promise<ToolResult>;
      onObservation?: (obs: Observation) => void;
    }
  ) {
    this.config = { ...DEFAULT_LOOP_CONFIG, ...config };
    this.state = this.createInitialState();
    this.onPhaseChange = handlers?.onPhaseChange;
    this.onToolCall = handlers?.onToolCall;
    this.onObservation = handlers?.onObservation;
  }

  getState(): LoopState {
    return { ...this.state };
  }

  getConfig(): LoopConfig {
    return { ...this.config };
  }

  async run(goal: string, context?: Record<string, unknown>): Promise<LoopResult> {
    this.state = this.createInitialState();
    this.phaseHistory = [];

    try {
      await this.transition("goal");
      this.recordObservation("goal", `Goal: ${goal}`);

      await this.transition("context");
      this.recordObservation("context", `Context loaded: ${JSON.stringify(context || {})}`);

      await this.transition("plan");
      const plan = await this.generatePlan(goal, context);
      this.state.currentPlan = plan;
      this.recordObservation("plan", `Plan created: ${plan}`);

      await this.transition("plan_approval");
      const approved = await this.requestPlanApproval(plan);
      if (!approved) {
        this.recordObservation("plan_approval", "Plan rejected");
        return this.createResult(false, "Plan was rejected");
      }
      this.recordObservation("plan_approval", "Plan approved");

      while (!this.state.completionDetected && !this.state.stuckDetected) {
        if (this.shouldTerminate()) {
          break;
        }

        await this.transition("tool_selection");
        const toolCall = await this.selectTool();
        if (!toolCall) {
          this.state.completionDetected = true;
          break;
        }

        await this.transition("permission_check");
        const permitted = await this.checkPermission(toolCall);
        if (!permitted) {
          this.recordError("PERMISSION_FAILURE", `Permission denied for ${toolCall.name}`, "permission_check");
          continue;
        }

        await this.transition("tool_execution");
        const result = await this.executeTool(toolCall);
        this.state.commandsExecuted.push(`${toolCall.name}: ${JSON.stringify(toolCall.input)}`);

        await this.transition("observation");
        this.recordObservation("tool_execution", `Tool ${toolCall.name} ${result.success ? "succeeded" : "failed"}`);

        await this.transition("reason_decide");
        const decision = await this.reasonAndDecide(result);
        this.recordObservation("reason_decide", decision);

        await this.transition("next_action");
        const nextAction = await this.decideNextAction(decision);
        this.recordObservation("next_action", nextAction);

        if (nextAction === "verify") {
          await this.transition("verification");
          const verified = await this.verify();
          this.recordObservation("verification", `Verification ${verified ? "passed" : "failed"}`);
        }

        if (nextAction === "complete") {
          this.state.completionDetected = true;
        }

        this.checkStuck();

        this.state.iteration++;
        this.state.lastActivityTime = new Date();
      }

      await this.transition("review");
      const reviewResult = await this.review();
      this.recordObservation("review", reviewResult);

      await this.transition("complete");
      return this.createResult(true, reviewResult);
    } catch (err) {
      this.recordError(
        "UNKNOWN",
        err instanceof Error ? err.message : String(err),
        this.state.phase
      );
      return this.createResult(false, `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async executeToolCall(call: ToolCall): Promise<ToolResult> {
    if (this.onToolCall) {
      return this.onToolCall(call);
    }
    return {
      callId: call.id,
      success: true,
      output: `Executed ${call.name}`,
      duration: 0,
    };
  }

  private async transition(to: LoopPhase): Promise<void> {
    this.state.phase = to;
    this.phaseHistory.push({ phase: to, timestamp: new Date() });
    // Keep only last 10 entries (only last 5 are used for stuck detection)
    if (this.phaseHistory.length > 10) {
      this.phaseHistory = this.phaseHistory.slice(-10);
    }
    this.onPhaseChange?.(to, this.state);
  }

  private recordObservation(phase: LoopPhase, content: string): void {
    const obs: Observation = {
      id: randomUUID(),
      phase,
      content,
      timestamp: new Date(),
    };
    this.state.observations.push(obs);
    // Cap observations to prevent memory leak
    if (this.state.observations.length > 1000) {
      this.state.observations = this.state.observations.slice(-500);
    }
    this.onObservation?.(obs);
  }

  private recordError(type: FailureType, message: string, phase: LoopPhase): void {
    const error: LoopError = {
      id: randomUUID(),
      type,
      message,
      phase,
      timestamp: new Date(),
      recoverable: this.isRecoverable(type),
      retryCount: 0,
    };
    this.state.errors.push(error);
  }

  private isRecoverable(type: FailureType): boolean {
    const recoverableTypes: FailureType[] = [
      "NETWORK_FAILURE",
      "TIMEOUT",
      "TOOL_FAILURE",
      "RUNTIME_FAILURE",
    ];
    return recoverableTypes.includes(type);
  }

  private shouldTerminate(): boolean {
    if (this.state.iteration >= this.config.maxIterations) return true;
    if (this.state.tokensUsed >= this.config.maxTokenBudget) return true;
    if (Date.now() - this.state.startTime.getTime() >= this.config.maxTimeBudgetMs) return true;
    if (this.state.retriesUsed >= this.config.maxRetryBudget) return true;
    return false;
  }

  private checkStuck(): void {
    const detection = this.detectStuck();
    if (detection.isStuck) {
      this.state.stuckDetected = true;
      this.recordObservation("reason_decide", `Stuck detected: ${detection.reason}`);
    }
  }

  private detectStuck(): StuckDetection {
    const now = Date.now();
    const lastActivity = this.state.lastActivityTime.getTime();
    const lastActivityMs = now - lastActivity;

    if (lastActivityMs > this.config.stuckThresholdMs) {
      return {
        isStuck: true,
        reason: `No activity for ${Math.floor(lastActivityMs / 1000)}s`,
        lastActivityMs,
        samePhaseCount: 0,
      };
    }

    const recentPhases = this.phaseHistory.slice(-5);
    const phaseCounts = new Map<LoopPhase, number>();
    for (const { phase } of recentPhases) {
      phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);
    }

    for (const [phase, count] of phaseCounts) {
      if (count >= 3) {
        return {
          isStuck: true,
          reason: `Same phase ${phase} repeated ${count} times`,
          lastActivityMs,
          samePhaseCount: count,
        };
      }
    }

    return { isStuck: false, lastActivityMs, samePhaseCount: 0 };
  }

  private createInitialState(): LoopState {
    return {
      phase: "goal",
      iteration: 0,
      tokensUsed: 0,
      timeMs: 0,
      retriesUsed: 0,
      pendingApprovals: [],
      filesChanged: [],
      commandsExecuted: [],
      observations: [],
      errors: [],
      stuckDetected: false,
      completionDetected: false,
      startTime: new Date(),
      lastActivityTime: new Date(),
    };
  }

  private async generatePlan(goal: string, context?: Record<string, unknown>): Promise<string> {
    return `Plan for: ${goal}\nContext: ${JSON.stringify(context || {})}`;
  }

  private async requestPlanApproval(_plan: string): Promise<boolean> {
    return true;
  }

  private async selectTool(): Promise<ToolCall | null> {
    return null;
  }

  private async checkPermission(call: ToolCall): Promise<boolean> {
    return !call.permissionRequired;
  }

  private async executeTool(call: ToolCall): Promise<ToolResult> {
    return this.executeToolCall(call);
  }

  private async reasonAndDecide(result: ToolResult): Promise<string> {
    return result.success ? "Tool executed successfully" : `Tool failed: ${result.error}`;
  }

  private async decideNextAction(_decision: string): Promise<string> {
    return "complete";
  }

  private async verify(): Promise<boolean> {
    return true;
  }

  private async review(): Promise<string> {
    return `Loop completed after ${this.state.iteration} iterations`;
  }

  private createResult(success: boolean, output: string): LoopResult {
    return {
      success,
      finalPhase: this.state.phase,
      iterations: this.state.iteration,
      tokensUsed: this.state.tokensUsed,
      timeMs: Date.now() - this.state.startTime.getTime(),
      filesChanged: this.state.filesChanged,
      commandsExecuted: this.state.commandsExecuted,
      observations: this.state.observations,
      errors: this.state.errors,
      output,
    };
  }
}
