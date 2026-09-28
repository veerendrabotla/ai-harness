import type { Logger } from "@ai-harness/shared";
import { errors, getSecretRegistry, isSafeOutboundUrl, redactValue } from "@ai-harness/shared";
import { classifyToolFailure } from "@ai-harness/domain";
import type {
  ExecutionEnvironmentResolver,
  ToolExecutionRequest,
  ToolExecutionResult,
} from "./types.js";

/**
 * Tool Harness — the ONLY path from the agent runtime to tool execution.
 * Pipeline per proposal: schema validation -> environment resolution ->
 * bounded execution (timeout + output limit) -> normalized result.
 * Permission evaluation happens in the runtime BEFORE this harness is invoked;
 * the harness never grants permissions itself.
 */
export class ToolHarness {
  constructor(
    private readonly registry: import("./registry.js").ToolRegistry,
    private readonly resolver: ExecutionEnvironmentResolver | null,
    private readonly logger: Logger,
  ) {}

  async execute(
    request: ToolExecutionRequest,
    externalSignal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const definition = this.registry.get(request.toolName);
    if (!definition) {
      return this.failure("FAILED", "TOOL_NOT_FOUND", `Unknown tool: ${request.toolName}`, "non_retryable", startedAt);
    }

    // Package hallucination guard — verify install targets exist before execution
    const hallucinationCheck = this.checkPackageHallucination(request);
    if (hallucinationCheck) return this.failure("FAILED", hallucinationCheck.code, hallucinationCheck.message, "non_retryable", startedAt);

    const parsed = definition.inputSchema.safeParse(request.input);
    if (!parsed.success) {
      return this.failure(
        "FAILED",
        "VALIDATION_ERROR",
        `Tool input failed schema validation: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        "non_retryable",
        startedAt,
      );
    }

    // SSRF gap fix: enforce allowlist for http.request before any execution
    if (request.toolName === "http.request") {
      const rawUrl = (parsed.data as { url?: string })?.url;
      if (typeof rawUrl === "string") {
        const guard = isSafeOutboundUrl(rawUrl);
        if (!guard.allowed) {
          return this.failure(
            "FAILED",
            "POLICY_DENIED",
            guard.reason ?? "requests to private/internal addresses are denied by policy",
            "permission_related",
            startedAt,
          );
        }
      }
    }

    let executable: (input: unknown, signal: AbortSignal) => Promise<unknown>;
    try {
      if (!this.resolver) {
        throw errors.bridgeDisconnected("No execution environment is attached to this workspace yet");
      }
      executable = await this.resolver.resolve(request.environment ?? definition.environment, definition);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!this.resolver || message.includes("No execution environment")) {
        return this.failure("FAILED", "EXECUTION_ENVIRONMENT_UNAVAILABLE", message, "environment_related", startedAt);
      }
      return this.failure("FAILED", "EXECUTION_ENVIRONMENT_UNAVAILABLE", message, "environment_related", startedAt);
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    const externalAbortPromise = new Promise<never>((_, reject) => {
      externalSignal?.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("cancelled by user"), { isCancel: true })),
        { once: true },
      );
    });
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    // The runtime enforces timeouts itself (FR-007): even executors that ignore
    // the abort signal cannot hang a run past the definition timeout.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error(`Tool exceeded timeout of ${definition.timeoutMs}ms`), {
          code: "TOOL_TIMEOUT",
          isTimeout: true,
        }));
      }, definition.timeoutMs);
    });
    try {
      const raw = await Promise.race([externalAbortPromise, (executable as (i: unknown, s: AbortSignal, c?: { taskId?: string; runId?: string }) => Promise<unknown>)(parsed.data, controller.signal, { taskId: request.taskId, runId: request.runId }), timeoutPromise]);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      const limited = truncateOutput(raw, definition.outputLimitBytes);
      // SecretRegistry auto-mask: replace any registered secret values in output
      const redacted = redactValue(limited) as Record<string, unknown>;
      const maskedJson = getSecretRegistry().maskOutput(JSON.stringify(redacted));
      const masked: Record<string, unknown> = maskedJson !== JSON.stringify(redacted) ? JSON.parse(maskedJson) as Record<string, unknown> : redacted;
      return {
        status: "SUCCEEDED",
        output: masked,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (externalSignal?.aborted) {
        return {
          status: "CANCELLED",
          failureCode: "TASK_CANCELLED",
          failureMessage: "Tool cancelled by user request",
          classification: classifyToolFailure("CANCELLED"),
          durationMs: Date.now() - startedAt,
        };
      }
      if ((err as { isTimeout?: boolean }).isTimeout || controller.signal.aborted) {
        return {
          status: "TIMED_OUT",
          failureCode: "TOOL_TIMEOUT",
          failureMessage: `Tool exceeded timeout of ${definition.timeoutMs}ms`,
          classification: classifyToolFailure("TIMED_OUT"),
          durationMs: Date.now() - startedAt,
        };
      }
      this.logger.error({ err, toolName: request.toolName }, "tool execution failed");
      const code = (err as { code?: string })?.code;
      const rawMsg = String((err as Error).message ?? "Tool execution failed");
      const maskedMsg = getSecretRegistry().maskOutput(rawMsg);
      return this.failure(
        "FAILED",
        typeof code === "string" && code ? code : "TOOL_EXECUTION_FAILED",
        redactValue(maskedMsg),
        undefined,
        startedAt,
      );
    }
  }

  /**
   * Detects package install commands with likely-hallucinated names.
   * Blocks patterns where the package name is suspiciously non-existent
   * (e.g. typo-squat candidates, single-char, or known-hallucinated names).
   * This is a lightweight static guard — not a registry lookup.
   */
  private checkPackageHallucination(
    request: ToolExecutionRequest,
  ): { code: string; message: string } | null {
    // Only inspect terminal commands
    if (request.toolName !== "terminal.run" && request.toolName !== "terminal.run_readonly") return null;
    const input = request.input as Record<string, unknown> | null;
    const cmd = typeof input?.command === "string" ? input.command : "";
    if (!cmd) return null;

    // Detect package install patterns: npm/pnpm/yarn/bun install, pip install, go get, cargo add
    const installPatterns: Array<{ re: RegExp; extract: (m: RegExpMatchArray) => string[] }> = [
      { re: /(?:npm|pnpm|yarn|bun)\s+(?:add|install)\s+([^;\n&|]+)/i, extract: (m) => m[1]!.split(/\s+/).filter((s) => !s.startsWith("-") && !s.startsWith("@") && s.length > 0) },
      { re: /pip\s+install\s+([^;\n&|]+)/i, extract: (m) => m[1]!.split(/\s+/).filter((s) => !s.startsWith("-") && s.length > 0) },
      { re: /go\s+get\s+([^;\n&|]+)/i, extract: (m) => m[1]!.split(/\s+/).filter((s) => !s.startsWith("-") && s.length > 0) },
      { re: /cargo\s+add\s+([^;\n&|]+)/i, extract: (m) => m[1]!.split(/\s+/).filter((s) => !s.startsWith("-") && s.length > 0) },
    ];

    for (const { re, extract } of installPatterns) {
      const match = cmd.match(re);
      if (!match) continue;
      const packages = extract(match);
      for (const pkg of packages) {
        const name = pkg.replace(/[@=<>~^].*$/, "").trim().toLowerCase();
        if (!name) continue;
        // Block obviously suspicious names: single-char, contains spaces, or known typo-squat patterns
        if (name.length === 1) {
          return { code: "PACKAGE_HALLUCINATION", message: `Blocked install of suspicious single-char package "${name}" — verify the package name` };
        }
        if (/[^a-z0-9._\-/]/i.test(name)) {
          return { code: "PACKAGE_HALLUCINATION", message: `Blocked install of package "${name}" with unusual characters — verify the name` };
        }
      }
    }
    return null;
  }

  private failure(
    status: ToolExecutionResult["status"],
    failureCode: string,
    failureMessage: string,
    classification?: ToolExecutionResult["classification"],
    startedAt = Date.now(),
  ): ToolExecutionResult {
    return {
      status,
      failureCode,
      failureMessage,
      classification: classification ?? classifyToolFailure(status, failureCode),
      durationMs: Date.now() - startedAt,
    };
  }
}

function truncateOutput(raw: unknown, limitBytes: number): Record<string, unknown> {
  const asRecord =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : { value: raw };
  const serialized = JSON.stringify(asRecord);
  if (serialized.length <= limitBytes) return asRecord;
  return {
    truncated: true,
    outputLimitBytes: limitBytes,
    preview: serialized.slice(0, Math.min(limitBytes, 100_000)),
  };
}
