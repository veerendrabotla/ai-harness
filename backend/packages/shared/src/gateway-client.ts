import { randomUUID } from "node:crypto";

export interface GatewayClientOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs?: number;
}

/**
 * Internal client for worker/API → bridge-gateway execution calls.
 * The gateway correlates the request over its WebSocket to the named bridge.
 */
export class BridgeGatewayClient {
  constructor(private readonly options: GatewayClientOptions) {}

  async execute(
    bridgeId: string,
    kind: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);
    try {
      const res = await fetch(`${this.options.baseUrl}/execute`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": this.options.internalToken,
        },
        body: JSON.stringify({ bridgeId, request: { id: randomUUID(), kind, params, timeoutMs } }),
        signal: controller.signal,
      });
      if (res.status === 503) {
        return { ok: false, error: { code: "BRIDGE_DISCONNECTED", message: "Bridge is not connected" } };
      }
      if (res.status === 404) {
        return { ok: false, error: { code: "BRIDGE_DISCONNECTED", message: "Bridge not found" } };
      }
      if (!res.ok) {
        return { ok: false, error: { code: "BRIDGE_DISCONNECTED", message: `Gateway HTTP ${res.status}` } };
      }
      return (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
    } catch (err) {
      return {
        ok: false,
        error: { code: "BRIDGE_DISCONNECTED", message: err instanceof Error ? err.message : String(err) },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
