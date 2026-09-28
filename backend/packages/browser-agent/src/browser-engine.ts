import type { Browser, Page } from "playwright";
import type {
  BrowserAgentConfig,
  BrowserStep,
  BrowserResult,
  TestResult,
  BrowserStepResult,
} from "./types.js";

export class BrowserAgentEngine {
  private config: BrowserAgentConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(config?: Partial<BrowserAgentConfig>) {
    this.config = {
      headless: config?.headless ?? true,
      timeout: config?.timeout ?? 30000,
      viewport: config?.viewport ?? { width: 1280, height: 720 },
      userAgent: config?.userAgent,
      devtools: config?.devtools ?? false,
    };
  }

  async launch(): Promise<void> {
    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ headless: this.config.headless });
    this.page = await this.browser.newPage({
      viewport: this.config.viewport,
      userAgent: this.config.userAgent,
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async executeStep(step: BrowserStep): Promise<BrowserResult> {
    const start = Date.now();

    if (!this.page) {
      return {
        success: false,
        error: "Browser not launched",
        duration: Date.now() - start,
      };
    }

    try {
      switch (step.action) {
        case "navigate":
          await this.page.goto(step.url || "", {
            timeout: step.timeout || this.config.timeout,
          });
          return { success: true, duration: Date.now() - start };

        case "click":
          await this.page.click(step.selector || "", {
            timeout: step.timeout || this.config.timeout,
          });
          return { success: true, duration: Date.now() - start };

        case "type":
          await this.page.fill(step.selector || "", step.value || "", {
            timeout: step.timeout || this.config.timeout,
          });
          return { success: true, duration: Date.now() - start };

        case "screenshot":
          const screenshot = await this.page.screenshot({
            path: step.value,
            fullPage: true,
          });
          return {
            success: true,
            screenshot: screenshot.toString("base64"),
            duration: Date.now() - start,
          };

        case "evaluate":
          const result = await this.page.evaluate(step.code || "");
          return {
            success: true,
            output: JSON.stringify(result),
            duration: Date.now() - start,
          };

        default:
          return {
            success: false,
            error: `Unknown action: ${step.action}`,
            duration: Date.now() - start,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  async runTestSteps(steps: BrowserStep[]): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: BrowserStepResult[] = [];
    let allPassed = true;

    for (const step of steps) {
      const result = await this.executeStep(step);
      stepResults.push({ step, result });

      if (!result.success) {
        allPassed = false;
        break;
      }
    }

    const screenshotStep = stepResults.find((sr) => sr.step.action === "screenshot");

    return {
      passed: allPassed,
      steps: stepResults,
      screenshot: screenshotStep?.result.screenshot,
      duration: Date.now() - startTime,
    };
  }

  isLaunched(): boolean {
    return this.browser !== null && this.page !== null;
  }
}
