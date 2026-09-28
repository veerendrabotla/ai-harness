import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { ToolRegistry } from "./registry.js";

/**
 * V1 tool definitions exactly as listed in AGENT_RUNTIME.md §11.
 * Every filesystem/terminal/git tool is bound to LOCAL_BRIDGE or CLOUD_SANDBOX
 * execution environments; neither is provisioned in the initial build, so the
 * harness returns structured environment failures instead of pretending success.
 * Path traversal protection and root confinement live inside those environments
 * and will be enforced by the Local Bridge (never by the browser).
 */

const pathSchema = z.string().min(1).max(4096);

function def(
  name: string,
  description: string,
  riskLevel: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL",
  inputSchema: z.ZodTypeAny,
  opts: Partial<Pick<ToolDefinition, "timeoutMs" | "outputLimitBytes">> = {},
): ToolDefinition {
  return {
    name,
    description,
    riskLevel,
    inputSchema,
    resultSchema: z.record(z.unknown()),
    timeoutMs: opts.timeoutMs ?? 30_000,
    outputLimitBytes: opts.outputLimitBytes ?? 256_000,
    environment: name === "checkpoint.create" || name === "checkpoint.rollback" || name === "mcp.call" || name === "http.request"
      ? "INTERNAL"
      : "LOCAL_BRIDGE",
  };
}

const READ_TOOLS: ToolDefinition[] = [
  def("filesystem.list", "List directory entries within a registered project root", "READ",
    z.object({ root: pathSchema, path: z.string().default(".") })),
  def("filesystem.read", "Read a file within a registered project root", "READ",
    z.object({ root: pathSchema, path: pathSchema, offsetLines: z.number().int().min(0).optional() }),
    { outputLimitBytes: 512_000 }),
  def("filesystem.search", "Search file contents with a pattern", "READ",
    z.object({ root: pathSchema, query: z.string().min(1).max(500), glob: z.string().optional() })),
  def("git.status", "Show working tree status of the project root", "READ",
    z.object({ root: pathSchema })),
  def("git.diff", "Show uncommitted changes", "READ",
    z.object({ root: pathSchema, staged: z.boolean().default(false) })),
  def("terminal.run_readonly", "Run an allow-listed read-only command (git log, ls, etc.)", "READ",
    z.object({ root: pathSchema, command: z.string().min(1).max(2000) }), { timeoutMs: 60_000 }),
];

const WRITE_TOOLS: ToolDefinition[] = [
  def("filesystem.write", "Write content to a file inside the project root", "WRITE",
    z.object({ root: pathSchema, path: pathSchema, content: z.string().max(2_000_000) })),
  def("filesystem.create", "Create a new file inside the project root", "WRITE",
    z.object({ root: pathSchema, path: pathSchema, content: z.string().max(2_000_000) })),
  def("filesystem.rename", "Rename/move a file inside the project root", "WRITE",
    z.object({ root: pathSchema, from: pathSchema, to: pathSchema })),
  def("filesystem.delete", "Delete a file inside the project root", "DESTRUCTIVE",
    z.object({ root: pathSchema, path: pathSchema })),
  def("terminal.run", "Execute an arbitrary command under policy controls", "DESTRUCTIVE",
    z.object({ root: pathSchema, command: z.string().min(1).max(2000) }), { timeoutMs: 120_000 }),
];

const CHECKPOINT_TOOLS: ToolDefinition[] = [
  def("checkpoint.create", "Create a recoverable checkpoint of project state", "READ",
    z.object({ projectId: z.string().uuid(), label: z.string().max(160).optional() })),
  def("checkpoint.rollback", "Roll the project back to a checkpoint", "DESTRUCTIVE",
    z.object({ checkpointId: z.string().uuid() })),
];

const INTEGRATION_TOOLS: ToolDefinition[] = [
  def("mcp.call", "Invoke a tool exposed by an enabled MCP server via the proxy", "EXTERNAL",
    z.object({
      serverId: z.string().uuid(),
      mcpToolName: z.string().min(1).max(200),
      args: z.record(z.unknown()).default({}),
    })),
  def("http.request", "Perform a policy-restricted outbound HTTP request", "EXTERNAL",
    z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      url: z.string().url(),
      headers: z.record(z.string()).optional(),
      body: z.string().max(1_000_000).optional(),
    }), { timeoutMs: 45_000 }),
];

const GIT_INTELLIGENCE_TOOLS: ToolDefinition[] = [
  def("git.branch", "Create or list git branches", "WRITE",
    z.object({ root: pathSchema, name: z.string().optional(), startPoint: z.string().optional() })),
  def("git.commit", "Create a git commit with AI-generated or provided message", "WRITE",
    z.object({ root: pathSchema, message: z.string().min(1).max(500), files: z.array(z.string()).optional() })),
  def("git.log", "Show git log with optional filters", "READ",
    z.object({ root: pathSchema, count: z.number().int().min(1).max(100).default(10), author: z.string().optional() })),
  def("git.blame", "Show git blame for a file", "READ",
    z.object({ root: pathSchema, path: pathSchema })),
  def("git.merge", "Merge a branch into the current branch", "WRITE",
    z.object({ root: pathSchema, branch: z.string().min(1) })),
  def("git.stash", "Stash or pop stashed changes", "WRITE",
    z.object({ root: pathSchema, action: z.enum(["push", "pop", "list"]), message: z.string().optional() })),
];

const DEPLOY_TOOLS: ToolDefinition[] = [
  def("deploy.start", "Start a deployment for a project (triggers build + deploy pipeline)", "EXTERNAL",
    z.object({
      projectId: z.string().uuid(),
      buildCommand: z.string().max(2048).default("npm run build"),
      environment: z.enum(["production", "preview", "staging"]).default("production"),
      outputDir: z.string().max(512).optional(),
      taskId: z.string().uuid().optional(),
      checkpointId: z.string().uuid().optional(),
    }), { timeoutMs: 300_000 }),
  def("deploy.status", "Check the status of a deployment", "READ",
    z.object({ deploymentId: z.string().uuid() })),
  def("deploy.logs", "Get build/runtime logs for a deployment", "READ",
    z.object({ deploymentId: z.string().uuid(), stream: z.enum(["build", "runtime"]).default("build") })),
];

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [...READ_TOOLS, ...WRITE_TOOLS, ...CHECKPOINT_TOOLS, ...INTEGRATION_TOOLS, ...GIT_INTELLIGENCE_TOOLS, ...DEPLOY_TOOLS]) {
    registry.register(tool);
  }
  return registry;
}
