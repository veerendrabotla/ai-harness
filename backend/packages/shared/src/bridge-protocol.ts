/**
 * Wire protocol between the Bridge Gateway and connected Local Bridge agents,
 * plus the internal execute API used by the worker/API to reach a bridge.
 */

export type BridgeToolKind =
  | "fs.list"
  | "fs.read"
  | "fs.search"
  | "fs.write"
  | "fs.create"
  | "fs.rename"
  | "fs.delete"
  | "git.status"
  | "git.diff"
  | "term.ro"
  | "term.run"
  | "terminal.run"
  | "terminal.ro"
  | "process.start"
  | "process.stop"
  | "process.status"
  | "process.logs"
  | "ckpt.create"
  | "ckpt.diff"
  | "ckpt.rollback"
  | "http.proxy"
  | "mcp.stdio";

export interface BridgeExecRequest {
  id: string;
  kind: BridgeToolKind;
  params: Record<string, unknown>;
  timeoutMs: number;
}

export interface BridgeExecResponse {
  id: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface CheckpointStateReference {
  kind: "git";
  root: string;
  headBefore: string;
  ref: string;
  createdStash: boolean;
}

export interface McpStdioParams {
  command: string;
  args?: string[];
  /** Full JSON-RPC request object written to the server's stdin. */
  rpc: Record<string, unknown>;
}

export function toolKindForToolName(toolName: string): BridgeToolKind | null {
  switch (toolName) {
    case "filesystem.list": return "fs.list";
    case "filesystem.read": return "fs.read";
    case "filesystem.search": return "fs.search";
    case "filesystem.write": return "fs.write";
    case "filesystem.create": return "fs.create";
    case "filesystem.rename": return "fs.rename";
    case "filesystem.delete": return "fs.delete";
    case "git.status": return "git.status";
    case "git.diff": return "git.diff";
    case "terminal.run_readonly": return "term.ro";
    case "terminal.run": return "term.run";
    case "checkpoint.create": return "ckpt.create";
    case "checkpoint.diff": return "ckpt.diff";
    case "checkpoint.rollback": return "ckpt.rollback";
    default: return null;
  }
}
