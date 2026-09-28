export type BrowserAction =
  | "navigate" | "click" | "type" | "select"
  | "screenshot" | "evaluate" | "wait" | "scroll";

export interface BrowserStep {
  action: BrowserAction;
  selector?: string;
  value?: string;
  url?: string;
  code?: string;
  timeout?: number;
}

export interface BrowserResult {
  success: boolean;
  screenshot?: string;
  output?: string;
  error?: string;
  duration: number;
}

export interface BrowserAgentConfig {
  headless: boolean;
  timeout: number;
  viewport: { width: number; height: number };
  userAgent?: string;
  devtools?: boolean;
}

export interface TestResult {
  passed: boolean;
  steps: BrowserStepResult[];
  screenshot?: string;
  duration: number;
}

export interface BrowserStepResult {
  step: BrowserStep;
  result: BrowserResult;
}
