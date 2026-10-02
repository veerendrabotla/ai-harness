import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@ai-harness/shared";
import {
  ToolHarness,
  ToolRegistry,
  createDefaultToolRegistry,
} from "@ai-harness/tool-harness";
import { ModelAdapterRegistry, ModelRuntime } from "@ai-harness/model-adapters";
import { PrismaProjectMemoryEngine } from "@ai-harness/project-memory";
import { InMemoryTraceCollector, TracePersistence } from "@ai-harness/agent-observability";
import { SessionEngine } from "@ai-harness/session-engine";
import { MCPRegistry } from "@ai-harness/mcp-platform";
import { InMemoryExtensionRegistry, type ExtensionRegistry } from "@ai-harness/extension-system";
import { EventPublisher } from "./event-publisher.js";
import { Planner } from "./planner.js";
import { ModelRouter } from "./model-router.js";
import { ApprovalCoordinator } from "./approval-coordinator.js";
import { CheckpointManager } from "./checkpoint-manager.js";
import { VerificationEngine, type BrowserEngineLike } from "./verification-engine.js";
import { TaskOrchestrator, type RunOutcome } from "./orchestrator.js";
import { MemoryAwareOrchestrator } from "./memory-aware-orchestrator.js";
import { WikiMaintainer, createPrismaWikiDeps } from "./wiki-maintainer.js";
import { MultiAgentOrchestrator } from "./multi-agent-orchestrator.js";
import { InMemoryAgentCommunication, type AgentCommunicationChannel } from "./agent-communication.js";
import type { ProjectMemoryEngine } from "@ai-harness/project-memory";
import type { TraceBuilder } from "@ai-harness/agent-observability";
import { CodeSearch } from "@ai-harness/code-search";
import { FileWatcher } from "@ai-harness/file-watcher";

export interface AgentRuntime {
  orchestrator: TaskOrchestrator;
  memoryOrchestrator: MemoryAwareOrchestrator;
  multiAgentOrchestrator: MultiAgentOrchestrator;
  approvals: ApprovalCoordinator;
  events: EventPublisher;
  tools: ToolRegistry;
  harness: ToolHarness;
  adapters: ModelAdapterRegistry;
  modelRuntime: ModelRuntime;
  router: ModelRouter;
  planner: Planner;
  checkpoints: CheckpointManager;
  verification: VerificationEngine;
  memoryEngine: ProjectMemoryEngine;
  sessionEngine: SessionEngine;
  mcpRegistry: MCPRegistry;
  extensionRegistry: ExtensionRegistry;
  traceCollector: TraceBuilder;
  tracePersistence: TracePersistence;
  communication: AgentCommunicationChannel;
  codeSearch: CodeSearch;
  fileWatcher: FileWatcher;
}

/**
 * Composes the agent runtime with all subsystems.
 * `onTaskEvent` receives persisted events for realtime fan-out (Socket.IO).
 */
export function buildAgentRuntime(options: {
  prisma: PrismaClient;
  logger: Logger;
  environmentResolver?: import("@ai-harness/tool-harness").ExecutionEnvironmentResolver | null;
  execBridge?: ((toolName: string, input: Record<string, unknown>, timeoutMs: number) => Promise<Record<string, unknown>>) | undefined;
  control?: { register(taskId: string): AbortSignal; signal(taskId: string): AbortSignal | undefined; release(taskId: string): void };
  onTaskEvent?: (taskId: string, event: unknown) => void;
  onApprovalCreated?: (approval: { id: string; taskId: string; toolCallId: string | null; status: string; requestedScope: string; expiresAt: Date; workspaceId?: string }) => void;
  mcpRegistry?: MCPRegistry;
  browserEngine?: BrowserEngineLike | null;
}): AgentRuntime {
  const { prisma, logger } = options;

  const events = new EventPublisher(prisma, options.onTaskEvent);
  const planner = new Planner(prisma);
  const router = new ModelRouter(prisma);
  const approvals = new ApprovalCoordinator(prisma, events, options.onApprovalCreated);
  const checkpoints = new CheckpointManager(prisma, events, options.execBridge);
  const adapters = new ModelAdapterRegistry();
  const modelRuntime = new ModelRuntime({
    adapters: [
      adapters.require("ANTHROPIC"),
      adapters.require("OPENAI"),
      adapters.require("GOOGLE"),
      adapters.require("OLLAMA"),
    ],
    timeoutMs: 120_000,
    maxRetries: 2,
  });
  const tools = createDefaultToolRegistry();
  const harness = new ToolHarness(tools, options.environmentResolver ?? null, logger);
  const verification = new VerificationEngine(prisma, events, harness, options.browserEngine ?? null);

  const memoryEngine: ProjectMemoryEngine = new PrismaProjectMemoryEngine(prisma);
  const sessionEngine = new SessionEngine();
  const mcpRegistry = options.mcpRegistry ?? new MCPRegistry();
  const extensionRegistry = new InMemoryExtensionRegistry();
  const traceCollector = new InMemoryTraceCollector();
  const tracePersistence = new TracePersistence(prisma);
  const communication = new InMemoryAgentCommunication();

  const codeSearch = new CodeSearch();
  const fileWatcher = new FileWatcher({ paths: [], ignored: ["node_modules", ".git", "dist", ".next"] });
  // Wire file-watcher -> code-search: file deletions evict from index; creates/modifies
  // with content are handled via the orchestrator tool hook (which has file content).
  fileWatcher.onEvent((event) => {
    if (event.type === "delete") {
      codeSearch.removeFile(event.path);
    }
  });

  const orchestrator = new TaskOrchestrator(
    prisma,
    logger,
    events,
    planner,
    router,
    approvals,
    checkpoints,
    verification,
    adapters,
    tools,
    harness,
    options.control,
    traceCollector,
    tracePersistence,
    extensionRegistry,
    sessionEngine,
    codeSearch,
    fileWatcher,
    mcpRegistry,
  );

  const memoryOrchestrator = new MemoryAwareOrchestrator(
    orchestrator,
    prisma,
    logger,
    events,
    memoryEngine,
  );

  const multiAgentOrchestrator = new MultiAgentOrchestrator(
    orchestrator,
    prisma,
    logger,
    events,
    adapters,
    router,
    communication,
  );

  // First production lifecycle-hook subscriber: after each COMPLETED run,
  // refresh `.aiharness/wiki/` in the project repo (opt-in — skipped when the
  // wiki directory does not exist). Errors are swallowed by the maintainer and
  // by fireHooks; they never affect the run.
  const wikiMaintainer = new WikiMaintainer(createPrismaWikiDeps(prisma, harness), logger);
  orchestrator.onHook("afterComplete", (ctx) => wikiMaintainer.maintainFromHook(ctx));

  return {
    orchestrator,
    memoryOrchestrator,
    multiAgentOrchestrator,
    approvals,
    events,
    tools,
    harness,
    adapters,
    modelRuntime,
    router,
    planner,
    checkpoints,
    verification,
    memoryEngine,
    sessionEngine,
    mcpRegistry,
    extensionRegistry,
    traceCollector,
    tracePersistence,
    communication,
    codeSearch,
    fileWatcher,
  };
}

export type { RunOutcome };
