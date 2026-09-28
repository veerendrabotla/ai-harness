import type {
  AgentMode,
  ModeConfig,
  ModeContext,
  ModeTransition,
  ToolPermission,
} from "./types.js";
import { MODE_CONFIGS, MODE_TRANSITIONS } from "./types.js";

export class AgentModeManager {
  private currentMode: AgentMode = "build";
  private modeHistory: Array<{ mode: AgentMode; timestamp: Date; reason?: string }> = [];
  private approvedTransitions = new Set<string>();

  getMode(): AgentMode {
    return this.currentMode;
  }

  getConfig(mode?: AgentMode): ModeConfig {
    return MODE_CONFIGS[mode || this.currentMode];
  }

  getModeConfig(mode: AgentMode): ModeConfig {
    return MODE_CONFIGS[mode];
  }

  canTransition(from: AgentMode, to: AgentMode): boolean {
    const transition = MODE_TRANSITIONS.find((t) => t.from === from && t.to === to);
    return transition?.allowed ?? false;
  }

  requiresApproval(from: AgentMode, to: AgentMode): boolean {
    const transition = MODE_TRANSITIONS.find((t) => t.from === from && t.to === to);
    return transition?.requiresApproval ?? true;
  }

  getTransition(from: AgentMode, to: AgentMode): ModeTransition | undefined {
    return MODE_TRANSITIONS.find((t) => t.from === from && t.to === to);
  }

  async transition(
    to: Mode,
    context: ModeContext,
    approvalGranted?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    const from = this.currentMode;

    if (!this.canTransition(from, to)) {
      return { success: false, error: `Transition from ${from} to ${to} is not allowed` };
    }

    if (this.requiresApproval(from, to)) {
      const transitionKey = `${from}->${to}`;
      if (approvalGranted) {
        this.approvedTransitions.add(transitionKey);
      } else if (!this.approvedTransitions.has(transitionKey)) {
        return {
          success: false,
          error: `Transition from ${from} to ${to} requires approval. Use approveTransition() first.`,
        };
      }
      this.approvedTransitions.delete(transitionKey);
    }

    this.currentMode = to;
    this.modeHistory.push({ mode: to, timestamp: new Date() });

    return { success: true };
  }

  approveTransition(from: AgentMode, to: Mode): void {
    const transitionKey = `${from}->${to}`;
    this.approvedTransitions.add(transitionKey);
  }

  getHistory(): Array<{ mode: AgentMode; timestamp: Date; reason?: string }> {
    return [...this.modeHistory];
  }

  validateToolAccess(toolName: string, mode?: AgentMode): boolean {
    const config = this.getConfig(mode);
    return config.allowedTools.includes(toolName);
  }

  getToolPermission(toolName: string, mode?: AgentMode): ToolPermission {
    const config = this.getConfig(mode);
    return config.toolPermissions[toolName] || "none";
  }

  canModifyFiles(mode?: AgentMode): boolean {
    return this.getConfig(mode).canModifyFiles;
  }

  canExecuteCommands(mode?: AgentMode): boolean {
    return this.getConfig(mode).canExecuteCommands;
  }

  requiresToolApproval(toolName: string, mode?: AgentMode): boolean {
    const config = this.getConfig(mode);
    return config.approvalRequiredFor.includes(toolName);
  }

  getAvailableTransitions(): ModeTransition[] {
    return MODE_TRANSITIONS.filter((t) => t.from === this.currentMode && t.allowed);
  }

  reset(): void {
    this.currentMode = "build";
    this.modeHistory = [];
    this.approvedTransitions.clear();
  }
}

export type Mode = AgentMode;
