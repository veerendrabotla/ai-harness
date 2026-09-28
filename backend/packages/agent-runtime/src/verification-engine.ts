import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import type { ExecutionEnvironment, ToolHarness } from "@ai-harness/tool-harness";
import type { EventPublisher } from "./event-publisher.js";

/** Minimal browser-engine contract — duck-typed to avoid hard dependency on @ai-harness/browser-agent. */
export interface BrowserEngineLike {
  isLaunched(): boolean;
  launch(): Promise<void>;
  close?(): Promise<void>;
  executeStep(step: {
    action: string;
    selector?: string;
    value?: string;
    url?: string;
    code?: string;
    timeout?: number;
  }): Promise<{ success: boolean; error?: string; output?: string; screenshot?: string; duration: number }>;
}

function isBrowserCommand(command: string): boolean {
  return command.trim().toLowerCase().startsWith("browser:");
}

function parseBrowserCommand(command: string): { url: string; expectedText?: string } | null {
  const raw = command.replace(/^browser:\s*/i, "").trim();
  const urlMatch = raw.match(/https?:\/\/[^\s"']+/);
  if (!urlMatch) return null;
  const url = urlMatch[0].replace(/[),.]+$/, "");
  const quoted = raw.match(/["'`\u201C\u201D]([^"'`\u201C\u201D]+)["'`\u201C\u201D]/);
  let expectedText: string | undefined;
  if (quoted?.[1]) {
    expectedText = quoted[1];
  } else {
    const kw = raw.match(/(?:should\s+show|should\s+contain|should\s+display|show|contains?|display|includes?)\s+["']?([^"'\n]+)/i);
    if (kw?.[1]) expectedText = kw[1].trim().split(/\s*-\s*|\s*\(/)[0]?.trim();
  }
  return { url, expectedText };
}

/**
 * Verification Engine (AGENT_RUNTIME.md §15 / PRD F-16).
 * Executes verification commands through the ToolHarness (terminal tool)
 * and records results as first-class verification records.
 */
export class VerificationEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventPublisher,
    private readonly harness: ToolHarness,
    private readonly browserEngine?: BrowserEngineLike | null,
  ) {}

  async verify(input: {
    taskId: string;
    runId: string;
    commands: Array<{ command: string }>;
    projectId?: string;
    root?: string;
    environment?: ExecutionEnvironment;
  }): Promise<Array<{ command: string; status: "PASSED" | "FAILED" | "SKIPPED" | "ERROR"; output?: string }>> {
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: input.runId,
      eventType: TASK_EVENT_TYPES.VERIFICATION_STARTED,
      actorType: "SYSTEM",
      payload: { commandCount: input.commands.length },
    });

    if (!input.commands.length) {
      await this.events.publishAndEmit({
        taskId: input.taskId,
        runId: input.runId,
        eventType: TASK_EVENT_TYPES.VERIFICATION_COMPLETED,
        actorType: "SYSTEM",
        payload: { results: [], allPassed: true, note: "No verification commands configured." },
      });
      return [];
    }

    const results: Array<{ command: string; status: "PASSED" | "FAILED" | "SKIPPED" | "ERROR"; output?: string }> = [];

    for (const entry of input.commands) {
      const command = entry.command;
      let status: "PASSED" | "FAILED" | "SKIPPED" | "ERROR" = "SKIPPED";
      let output: string | undefined;

      // ── Browser-agent verification (optional) ───────────────────────
      if (isBrowserCommand(command)) {
        if (!this.browserEngine) {
          status = "SKIPPED";
          output = "skipped: no browser engine wired";
        } else {
          const parsed = parseBrowserCommand(command);
          if (!parsed) {
            status = "SKIPPED";
            output = "skipped: could not parse browser verification command";
          } else {
            try {
              if (!this.browserEngine.isLaunched()) {
                await this.browserEngine.launch();
              }
              const nav = await this.browserEngine.executeStep({
                action: "navigate",
                url: parsed.url,
              });
              if (!nav.success) {
                status = "FAILED";
                output = nav.error ?? `failed to navigate to ${parsed.url}`;
              } else if (parsed.expectedText) {
                const evalRes = await this.browserEngine.executeStep({
                  action: "evaluate",
                  code: `document.body.innerText.includes(${JSON.stringify(parsed.expectedText)})`,
                });
                if (!evalRes.success) {
                  status = "ERROR";
                  output = evalRes.error ?? "browser evaluate failed";
                } else {
                  let isTrue = false;
                  try {
                    const parsedOut = evalRes.output !== undefined ? JSON.parse(evalRes.output) : false;
                    isTrue = parsedOut === true;
                  } catch {
                    isTrue = evalRes.output === "true" || evalRes.output === '"true"';
                  }
                  if (isTrue) {
                    status = "PASSED";
                    output = `browser: ${parsed.url} contains "${parsed.expectedText}"`;
                  } else {
                    status = "FAILED";
                    output = `browser: ${parsed.url} does not contain "${parsed.expectedText}"`;
                  }
                }
              } else {
                status = "PASSED";
                output = `browser: navigated to ${parsed.url}`;
              }
            } catch (err) {
              status = "ERROR";
              output = err instanceof Error ? err.message : String(err);
            }
          }
        }
      } else {
        try {
          const result = await this.harness.execute({
            toolCallId: randomUUID(),
            taskId: input.taskId,
            runId: input.runId,
            toolName: "terminal.run",
            input: { root: input.root ?? input.projectId ?? "/", command },
            environment: input.environment,
          });

          if (result.status === "SUCCEEDED") {
            status = "PASSED";
            output = typeof result.output === "string"
              ? result.output
              : JSON.stringify(result.output ?? "");
          } else {
            status = "FAILED";
            output = result.failureMessage ?? "";
          }
        } catch (err) {
          status = "ERROR";
          output = err instanceof Error ? err.message : String(err);
        }
      }

      await this.prisma.verificationResult.create({
        data: {
          id: randomUUID(),
          taskId: input.taskId,
          runId: input.runId,
          command: command.slice(0, 4000),
          status,
          outputReference: output?.slice(0, 4000) ?? null,
        },
      });
      results.push({ command, status, output });
    }

    const allPassed = results.every((r) => r.status === "PASSED" || r.status === "SKIPPED");
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: input.runId,
      eventType: TASK_EVENT_TYPES.VERIFICATION_COMPLETED,
      actorType: "SYSTEM",
      payload: {
        results: results.map((r) => ({ command: r.command, status: r.status })),
        allPassed,
      },
    });

    return results;
  }

  /**
   * Auto-generate verification commands from a project's detected scripts.
   * Returns typecheck, lint, test, and build commands in priority order.
   */
  static inferVerificationCommands(projectAnalysis: {
    scripts?: Array<{ name: string; command: string; purpose: string }>;
    conventions?: { tsConfig?: boolean };
    testSetup?: { framework?: string | null; hasTests?: boolean };
  }): Array<{ command: string }> {
    const commands: Array<{ command: string }> = [];
    const scripts = projectAnalysis.scripts ?? [];

    // Priority: typecheck > lint > test > build
    const typecheckScript = scripts.find((s) => s.purpose === "typecheck");
    if (typecheckScript) {
      commands.push({ command: `npm run ${typecheckScript.name}` });
    } else if (projectAnalysis.conventions?.tsConfig) {
      commands.push({ command: "npx tsc --noEmit" });
    }

    const lintScript = scripts.find((s) => s.purpose === "lint");
    if (lintScript) {
      commands.push({ command: `npm run ${lintScript.name}` });
    }

    const testScript = scripts.find((s) => s.purpose === "test");
    if (testScript && projectAnalysis.testSetup?.hasTests) {
      commands.push({ command: `npm run ${testScript.name}` });
    }

    const buildScript = scripts.find((s) => s.purpose === "build");
    if (buildScript) {
      commands.push({ command: `npm run ${buildScript.name}` });
    }

    return commands;
  }
}
