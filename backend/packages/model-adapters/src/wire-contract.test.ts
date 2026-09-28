import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { OllamaAdapter } from "./ollama.js";
import { GoogleAdapter } from "./google.js";
import { AdapterError, type ProviderConnectionRef } from "./types.js";

type Recorded = { method: string; url: string; body: unknown; headers: Record<string, string | string[] | undefined> };

const recorded: Recorded[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

let server: Server;
let ollamaBase: string;
let googleBase: string;

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const raw = await readBody(req);
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* keep raw */
    }
    recorded.push({ method: req.method ?? "", url: req.url ?? "", body, headers: req.headers });

    const url = req.url ?? "";

    // Ollama wire
    if (url.startsWith("/api/chat")) {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(
        JSON.stringify({
          model: "qwen2.5:3b",
          created_at: "2026-01-01T00:00:00Z",
          message: { role: "assistant", content: '{"ok":true}' },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 11,
          eval_count: 7,
        }),
      );
      return;
    }
    if (url.startsWith("/api/tags")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }));
      return;
    }

    // Google wire (Gemini generateContent)
    if (url.includes(":generateContent")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "gemi-ni says hi" }], role: "model" },
              finishReason: "STOP",
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 9, totalTokenCount: 21 },
          responseId: "resp-abc-123",
        }),
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `no mock for ${url}` }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  ollamaBase = `http://127.0.0.1:${port}`;
  googleBase = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function connection(overrides: Partial<ProviderConnectionRef> = {}): ProviderConnectionRef {
  return {
    id: "conn-1",
    providerType: "OLLAMA",
    displayName: "wire test",
    credential: "test-credential",
    metadata: {},
    ...overrides,
  };
}

const baseRequest = {
  stage: "IMPLEMENTATION" as const,
  modelIdentifier: "qwen2.5:3b",
  systemInstructions: "You are the planner.",
  userObjective: "Add a greeting endpoint",
  contextItems: "src/app.ts\nREADME.md",
};

describe("Ollama adapter wire contract (vs local mock HTTP server)", () => {
  it("POSTs /api/chat with system+user messages, format and options, and maps the response", async () => {
    recorded.length = 0;
    const adapter = new OllamaAdapter();
    const response = await adapter.generate(
      { ...baseRequest, responseSchemaName: "PLAN", maxOutputTokens: 512, temperature: 0.2 },
      connection({ providerType: "OLLAMA", metadata: { baseUrl: ollamaBase } }),
    );

    const req = recorded.find((r) => r.url.startsWith("/api/chat"));
    expect(req, "no /api/chat request recorded").toBeDefined();
    expect(req!.method).toBe("POST");

    const body = req!.body as {
      model: string;
      stream: boolean;
      format?: string;
      messages: Array<{ role: string; content: string }>;
      options: { num_predict: number; temperature: number };
    };
    expect(body.model).toBe("qwen2.5:3b");
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("You are the planner.");
    expect(body.messages[0]?.content).toContain("Respond with ONLY a single JSON object");
    expect(body.messages[1]?.content).toContain("Add a greeting endpoint");
    expect(body.messages[1]?.content).toContain("src/app.ts");
    expect(body.options.num_predict).toBe(512);
    expect(body.options.temperature).toBe(0.2);

    expect(response.text).toBe('{"ok":true}');
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(response.finishReason).toBe("stop");
    expect(response.modelIdentifier).toBe("qwen2.5:3b");
    expect(response.providerType).toBe("OLLAMA");
  });

  it("healthCheck hits /api/tags and reports ok", async () => {
    recorded.length = 0;
    const adapter = new OllamaAdapter();
    const health = await adapter.healthCheck(
      connection({ providerType: "OLLAMA", metadata: { baseUrl: ollamaBase } }),
    );
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("1 models");
    expect(recorded.some((r) => r.url.startsWith("/api/tags"))).toBe(true);
  });

  it("rejects connections without baseUrl (NO_BASE_URL)", async () => {
    const adapter = new OllamaAdapter();
    await expect(
      adapter.generate({ ...baseRequest }, connection({ providerType: "OLLAMA", metadata: {} })),
    ).rejects.toMatchObject({ name: "AdapterError", code: "NO_BASE_URL" });
  });

  it("maps provider failures to a retryable AdapterError", async () => {
    const failing = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      await readBody(req);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
    });
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
    const { port } = failing.address() as AddressInfo;
    try {
      const adapter = new OllamaAdapter();
      const err = await adapter
        .generate({ ...baseRequest }, connection({ providerType: "OLLAMA", metadata: { baseUrl: `http://127.0.0.1:${port}` } }))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).retryable).toBe(true);
    } finally {
      await new Promise<void>((resolve) => failing.close(() => resolve()));
    }
  });
});

describe("Google adapter wire contract (vs local mock HTTP server)", () => {
  it("targets models/{model}:generateContent with systemInstruction + generationConfig and maps the response", async () => {
    recorded.length = 0;
    const adapter = new GoogleAdapter();
    const response = await adapter.generate(
      { ...baseRequest, modelIdentifier: "gemini-2.0-flash", maxOutputTokens: 1024, temperature: 0.7 },
      connection({ providerType: "GOOGLE", metadata: { baseUrl: googleBase } }),
    );

    const req = recorded.find((r) => r.url.includes(":generateContent"));
    expect(req, "no :generateContent request recorded").toBeDefined();
    expect(decodeURIComponent(req!.url)).toContain("models/gemini-2.0-flash:generateContent");

    const rawBody = JSON.stringify(req!.body);
    expect(rawBody).toContain("You are the planner.");
    expect(rawBody).toContain("Add a greeting endpoint");
    expect(rawBody).toContain("src/app.ts");
    const body = req!.body as {
      generationConfig?: { maxOutputTokens?: number; temperature?: number };
    };
    expect(body.generationConfig?.maxOutputTokens).toBe(1024);
    expect(body.generationConfig?.temperature).toBe(0.7);

    expect(response.text).toBe("gemi-ni says hi");
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 9 });
    expect(response.finishReason).toBe("STOP");
    // @google/genai 1.0.1: the mldev (Gemini API, non-Vertex) response converter
    // does not map responseId, so providerRequestId is null on this path.
    expect(response.providerRequestId).toBeNull();
    expect(response.modelIdentifier).toBe("gemini-2.0-flash");
    expect(response.providerType).toBe("GOOGLE");
  });

  it("healthCheck reports ok against the endpoint", async () => {
    recorded.length = 0;
    const adapter = new GoogleAdapter();
    const health = await adapter.healthCheck(
      connection({ providerType: "GOOGLE", metadata: { baseUrl: googleBase, healthCheckModel: "gemini-2.0-flash" } }),
    );
    expect(health.ok).toBe(true);
    expect(recorded.some((r) => r.url.includes(":generateContent"))).toBe(true);
  });

  it("rejects connections without credentials (NO_CREDENTIAL)", async () => {
    const adapter = new GoogleAdapter();
    await expect(
      adapter.generate({ ...baseRequest }, connection({ providerType: "GOOGLE", credential: "" })),
    ).rejects.toMatchObject({ name: "AdapterError", code: "NO_CREDENTIAL" });
  });

  it("maps provider failures to a retryable AdapterError", async () => {
    const failing = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      await readBody(req);
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "overloaded" } }));
    });
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
    const { port } = failing.address() as AddressInfo;
    try {
      const adapter = new GoogleAdapter();
      const err = await adapter
        .generate(
          { ...baseRequest, modelIdentifier: "gemini-2.0-flash" },
          connection({ providerType: "GOOGLE", metadata: { baseUrl: `http://127.0.0.1:${port}` } }),
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).retryable).toBe(true);
    } finally {
      await new Promise<void>((resolve) => failing.close(() => resolve()));
    }
  });
});
