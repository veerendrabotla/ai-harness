export type AgentMode = "build" | "plan" | "ask" | "review" | "fix";

export type ToolPermission = "none" | "read" | "write" | "execute" | "admin";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ModeConfig {
  mode: AgentMode;
  name: string;
  description: string;
  allowedTools: string[];
  toolPermissions: Record<string, ToolPermission>;
  canModifyFiles: boolean;
  canExecuteCommands: boolean;
  canAccessNetwork: boolean;
  canAccessSecrets: boolean;
  canDeploy: boolean;
  requiresApproval: boolean;
  approvalRequiredFor: string[];
  maxIterations: number;
  maxTokenBudget: number;
  maxTimeBudgetMs: number;
  verificationBehavior: "always" | "on-change" | "never";
  planningBehavior: "required" | "optional" | "none";
  outputFormat: "code" | "analysis" | "report" | "mixed";
}

export interface ModeContext {
  mode: AgentMode;
  workspaceId: string;
  projectId?: string;
  taskId?: string;
  userId: string;
  userRole: string;
  tokenBudget: number;
  timeBudgetMs: number;
  currentIteration: number;
  approvalRequired: boolean;
  filesChanged: string[];
  commandsExecuted: string[];
  errors: string[];
}

export interface ModeResult {
  success: boolean;
  mode: AgentMode;
  output: string;
  filesChanged: string[];
  commandsExecuted: string[];
  iterations: number;
  tokensUsed: number;
  timeMs: number;
  verificationPassed: boolean;
  approvalRequired: boolean;
  errors: string[];
}

export interface ModeTransition {
  from: AgentMode;
  to: AgentMode;
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

export const MODE_CONFIGS: Record<AgentMode, ModeConfig> = {
  build: {
    mode: "build",
    name: "Build",
    description: "Execute code changes, install dependencies, run builds, and verify results",
    allowedTools: [
      "read_file", "write_file", "delete_file", "list_files",
      "execute_command", "install_dependency", "run_tests",
      "git_commit", "git_diff", "git_log",
      "start_preview", "stop_preview",
    ],
    toolPermissions: {
      read_file: "read",
      write_file: "write",
      delete_file: "write",
      list_files: "read",
      execute_command: "execute",
      install_dependency: "execute",
      run_tests: "execute",
      git_commit: "write",
      git_diff: "read",
      git_log: "read",
      start_preview: "execute",
      stop_preview: "execute",
    },
    canModifyFiles: true,
    canExecuteCommands: true,
    canAccessNetwork: true,
    canAccessSecrets: false,
    canDeploy: false,
    requiresApproval: false,
    approvalRequiredFor: ["git_commit", "install_dependency", "execute_command"],
    maxIterations: 50,
    maxTokenBudget: 100_000,
    maxTimeBudgetMs: 30 * 60 * 1000,
    verificationBehavior: "on-change",
    planningBehavior: "required",
    outputFormat: "code",
  },

  plan: {
    mode: "plan",
    name: "Plan",
    description: "Analyze codebase, create execution plans, and propose changes without modifying files",
    allowedTools: [
      "read_file", "list_files", "git_diff", "git_log",
      "search_code", "analyze_dependencies",
    ],
    toolPermissions: {
      read_file: "read",
      list_files: "read",
      git_diff: "read",
      git_log: "read",
      search_code: "read",
      analyze_dependencies: "read",
    },
    canModifyFiles: false,
    canExecuteCommands: false,
    canAccessNetwork: false,
    canAccessSecrets: false,
    canDeploy: false,
    requiresApproval: false,
    approvalRequiredFor: [],
    maxIterations: 20,
    maxTokenBudget: 50_000,
    maxTimeBudgetMs: 10 * 60 * 1000,
    verificationBehavior: "never",
    planningBehavior: "none",
    outputFormat: "analysis",
  },

  ask: {
    mode: "ask",
    name: "Ask",
    description: "Answer questions about the codebase without making any changes",
    allowedTools: [
      "read_file", "list_files", "git_diff", "git_log",
      "search_code", "analyze_dependencies",
    ],
    toolPermissions: {
      read_file: "read",
      list_files: "read",
      git_diff: "read",
      git_log: "read",
      search_code: "read",
      analyze_dependencies: "read",
    },
    canModifyFiles: false,
    canExecuteCommands: false,
    canAccessNetwork: false,
    canAccessSecrets: false,
    canDeploy: false,
    requiresApproval: false,
    approvalRequiredFor: [],
    maxIterations: 10,
    maxTokenBudget: 20_000,
    maxTimeBudgetMs: 5 * 60 * 1000,
    verificationBehavior: "never",
    planningBehavior: "none",
    outputFormat: "report",
  },

  review: {
    mode: "review",
    name: "Review",
    description: "Review code changes, analyze quality, security, and provide feedback",
    allowedTools: [
      "read_file", "list_files", "git_diff", "git_log",
      "search_code", "analyze_dependencies", "run_tests",
    ],
    toolPermissions: {
      read_file: "read",
      list_files: "read",
      git_diff: "read",
      git_log: "read",
      search_code: "read",
      analyze_dependencies: "read",
      run_tests: "read",
    },
    canModifyFiles: false,
    canExecuteCommands: false,
    canAccessNetwork: false,
    canAccessSecrets: false,
    canDeploy: false,
    requiresApproval: false,
    approvalRequiredFor: [],
    maxIterations: 15,
    maxTokenBudget: 30_000,
    maxTimeBudgetMs: 10 * 60 * 1000,
    verificationBehavior: "always",
    planningBehavior: "none",
    outputFormat: "report",
  },

  fix: {
    mode: "fix",
    name: "Fix",
    description: "Diagnose and fix specific issues, then verify the fix",
    allowedTools: [
      "read_file", "write_file", "delete_file", "list_files",
      "execute_command", "run_tests", "search_code",
      "git_commit", "git_diff", "git_log",
    ],
    toolPermissions: {
      read_file: "read",
      write_file: "write",
      delete_file: "write",
      list_files: "read",
      execute_command: "execute",
      run_tests: "execute",
      search_code: "read",
      git_commit: "write",
      git_diff: "read",
      git_log: "read",
    },
    canModifyFiles: true,
    canExecuteCommands: true,
    canAccessNetwork: false,
    canAccessSecrets: false,
    canDeploy: false,
    requiresApproval: false,
    approvalRequiredFor: ["git_commit"],
    maxIterations: 30,
    maxTokenBudget: 60_000,
    maxTimeBudgetMs: 15 * 60 * 1000,
    verificationBehavior: "always",
    planningBehavior: "optional",
    outputFormat: "code",
  },
};

export const MODE_TRANSITIONS: ModeTransition[] = [
  { from: "build", to: "plan", allowed: true, requiresApproval: false },
  { from: "build", to: "ask", allowed: true, requiresApproval: false },
  { from: "build", to: "review", allowed: true, requiresApproval: false },
  { from: "build", to: "fix", allowed: true, requiresApproval: false },

  { from: "plan", to: "build", allowed: true, requiresApproval: true, reason: "Plan must be approved before building" },
  { from: "plan", to: "ask", allowed: true, requiresApproval: false },
  { from: "plan", to: "review", allowed: true, requiresApproval: false },
  { from: "plan", to: "fix", allowed: true, requiresApproval: false },

  { from: "ask", to: "build", allowed: true, requiresApproval: true, reason: "Must switch to build mode to make changes" },
  { from: "ask", to: "plan", allowed: true, requiresApproval: false },
  { from: "ask", to: "review", allowed: true, requiresApproval: false },
  { from: "ask", to: "fix", allowed: true, requiresApproval: true, reason: "Must switch to fix mode to make changes" },

  { from: "review", to: "build", allowed: true, requiresApproval: true, reason: "Must switch to build mode to make changes" },
  { from: "review", to: "plan", allowed: true, requiresApproval: false },
  { from: "review", to: "ask", allowed: true, requiresApproval: false },
  { from: "review", to: "fix", allowed: true, requiresApproval: true, reason: "Must switch to fix mode to make changes" },

  { from: "fix", to: "build", allowed: true, requiresApproval: false },
  { from: "fix", to: "plan", allowed: true, requiresApproval: false },
  { from: "fix", to: "ask", allowed: true, requiresApproval: false },
  { from: "fix", to: "review", allowed: true, requiresApproval: false },
];
