import type { ProviderType } from "@ai-harness/contracts";
import {
  type HealthResult,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
  type ProviderConnectionRef,
} from "./types.js";

/**
 * Deterministic test adapter for E2E and integration testing.
 *
 * This adapter NEVER calls any external API. It returns scripted responses
 * based on the request stage and credential value. It is explicitly marked
 * as providerType "TEST" and must never be used in production.
 *
 * Credential format determines the scenario:
 *   - "plan-then-execute"  → returns a plan then tool calls
 *   - "plan-only"          → returns a plan, no tool calls
 *   - "fail-planning"      → throws AdapterError during planning
 *   - "fail-execution"     → throws AdapterError during implementation
 *   - "fail-retryable"     → throws retryable AdapterError
 *   - any other value      → returns a basic freeform text response
 */
export class TestAdapter implements ModelAdapter {
  readonly providerType: ProviderType = "TEST";

  async healthCheck(_connection: ProviderConnectionRef): Promise<HealthResult> {
    return { ok: true, detail: "TEST adapter (no external calls)", latencyMs: 1 };
  }

  async generate(request: ModelRequest, connection: ProviderConnectionRef): Promise<ModelResponse> {
    const scenario = connection.credential || "default";

    if (scenario === "fail-planning" && request.stage === "PLANNING") {
      throw new (await import("./types.js")).AdapterError(
        "TEST", "PROVIDER_ERROR", "TEST adapter: simulated planning failure", false,
      );
    }
    if (scenario === "fail-execution" && request.stage === "IMPLEMENTATION") {
      throw new (await import("./types.js")).AdapterError(
        "TEST", "PROVIDER_ERROR", "TEST adapter: simulated execution failure", false,
      );
    }
    if (scenario === "fail-retryable") {
      throw new (await import("./types.js")).AdapterError(
        "TEST", "PROVIDER_ERROR", "TEST adapter: simulated retryable failure", true,
      );
    }

    if (request.stage === "PLANNING") {
      return this.planResponse(request, scenario);
    }
    if (request.stage === "IMPLEMENTATION") {
      return this.implementResponse(request, scenario);
    }
    // REVIEW stage
    return this.reviewResponse(request);
  }

  async stream(
    request: ModelRequest,
    connection: ProviderConnectionRef,
    onDelta: (text: string) => void,
  ): Promise<ModelResponse> {
    const response = await this.generate(request, connection);
    onDelta(response.text);
    return response;
  }

  private planResponse(request: ModelRequest, scenario: string): ModelResponse {
    if (scenario === "plan-then-execute") {
      const plan = {
        analysis: "Deterministic test plan: create fixture file then verify.",
        assumptions: ["Test environment has filesystem access", "Bridge is connected"],
        affectedFiles: ["fixture.txt"],
        steps: [
          {
            id: "step-1",
            title: "Create fixture file",
            detail: "Create a test file with deterministic content",
            toolName: "filesystem.create",
            toolInput: { path: "fixture.txt", content: "Hello from test adapter\n" },
          },
          {
            id: "step-2",
            title: "Read fixture file",
            detail: "Verify the file was created correctly",
            toolName: "filesystem.read",
            toolInput: { path: "fixture.txt" },
          },
        ],
        risks: ["None - deterministic test"],
        verificationPlan: [{ command: "cat fixture.txt" }],
      };
      return {
        text: JSON.stringify(plan),
        usage: { inputTokens: 100, outputTokens: 200 },
        finishReason: "stop",
        providerRequestId: `test-plan-${Date.now()}`,
        modelIdentifier: request.modelIdentifier,
        providerType: "TEST",
      };
    }

    if (scenario === "plan-only") {
      const plan = {
        analysis: "Plan-only mode: analysis complete, no execution needed.",
        assumptions: ["User requested analysis only"],
        affectedFiles: [],
        steps: [
          {
            id: "step-1",
            title: "Analyze the request",
            detail: "Provide analysis of the user request",
          },
        ],
        risks: [],
        verificationPlan: [],
      };
      return {
        text: JSON.stringify(plan),
        usage: { inputTokens: 50, outputTokens: 100 },
        finishReason: "stop",
        providerRequestId: `test-plan-only-${Date.now()}`,
        modelIdentifier: request.modelIdentifier,
        providerType: "TEST",
      };
    }

    // default
    const plan = {
      analysis: "Default deterministic plan.",
      assumptions: [],
      affectedFiles: [],
      steps: [],
      risks: [],
      verificationPlan: [],
    };
    return {
      text: JSON.stringify(plan),
      usage: { inputTokens: 50, outputTokens: 50 },
      finishReason: "stop",
      providerRequestId: `test-default-${Date.now()}`,
      modelIdentifier: request.modelIdentifier,
      providerType: "TEST",
    };
  }

  private implementResponse(request: ModelRequest, scenario: string): ModelResponse {
    if (scenario === "plan-then-execute") {
      return {
        text: "Calling filesystem.create to write the fixture file.",
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
        providerRequestId: `test-impl-${Date.now()}`,
        modelIdentifier: request.modelIdentifier,
        providerType: "TEST",
        toolCalls: [
          {
            name: "filesystem.create",
            input: { path: "fixture.txt", content: "Hello from test adapter\n" },
          },
        ],
      };
    }

    return {
      text: "No tool needed for this step.",
      usage: { inputTokens: 50, outputTokens: 20 },
      finishReason: "stop",
      providerRequestId: `test-impl-${Date.now()}`,
      modelIdentifier: request.modelIdentifier,
      providerType: "TEST",
    };
  }

  private reviewResponse(request: ModelRequest): ModelResponse {
    return {
      text: JSON.stringify({
        blocking: [],
        non_blocking: [],
        confidence: "high",
      }),
      usage: { inputTokens: 50, outputTokens: 30 },
      finishReason: "stop",
      providerRequestId: `test-review-${Date.now()}`,
      modelIdentifier: request.modelIdentifier,
      providerType: "TEST",
    };
  }
}
