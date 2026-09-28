"use client";

import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  FileCode,
  FileText,
  FolderGit2,
  FolderOpen,
  Globe,
  History,
  Layers,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Shield,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type {
  EventLike,
  PlanLike,
  TaskDtoLike,
  WorkspaceDtoLike,
} from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useTaskSocket } from "@/lib/use-task-socket";
import { FileExplorer } from "@/components/file-explorer";
import { Terminal as TerminalComponent } from "@/components/terminal";
import { ModelSelector } from "@/components/model-selector";
import { PreviewPanel } from "@/components/preview-panel";
import { DeployPanel } from "@/components/deploy-panel";
import { CodeEditor, FileTabBar, type OpenFile } from "@/components/code-editor";
import { ConflictResolutionPanel, type ConflictFile } from "@/components/conflict-resolution-panel";
import { WebContainerPanel } from "@/components/webcontainer-panel";
import { useBreakpoint } from "@/lib/use-breakpoint";

/* ─── Types ──────────────────────────────────────────────── */

interface ProviderStatus { id: string; displayName: string; providerType: string; status: string }
interface ProjectStatus { id: string; name: string; connectionType: string; status: string }
interface ToolCallDto { id: string; toolName: string; riskLevel: string; inputSummary: unknown; resultSummary: unknown; status: string; startedAt: string | null; completedAt: string | null }
interface CheckpointDto { id: string; checkpointType: string; stateReference: unknown; createdAt: string }
interface VerificationResultDto { id: string; command: string; status: string; outputReference: string | null }

type AgentMode = "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX";
type RightTab = "files" | "changes" | "terminal" | "preview" | "activity" | "checkpoints" | "verification" | "deploy" | "webcontainer";

const AGENT_MODES: { key: AgentMode; label: string; desc: string; icon: typeof Zap }[] = [
  { key: "BUILD", label: "Build", desc: "Plan and execute", icon: Zap },
  { key: "PLAN", label: "Plan", desc: "Plan only, ask before executing", icon: FileText },
  { key: "ASK", label: "Ask", desc: "Analyze without modifying", icon: Shield },
  { key: "REVIEW", label: "Review", desc: "Inspect code and provide findings", icon: Code2 },
  { key: "FIX", label: "Fix", desc: "Investigate and repair an issue", icon: RotateCcw },
];

/* ─── State helpers ──────────────────────────────────────── */

const ACTIVE_STATES = new Set([
  "QUEUED","INITIALIZING","UNDERSTANDING","GATHERING_CONTEXT","PLANNING",
  "EXECUTING","WAITING_FOR_APPROVAL","WAITING_FOR_TOOL_APPROVAL",
  "OBSERVING","REPLANNING","VERIFYING","REVIEWING",
]);
const TERMINAL_STATES = new Set(["COMPLETED","FAILED","CANCELLED"]);

function stateColor(s: string): string {
  if (s === "COMPLETED") return "text-success";
  if (s === "FAILED") return "text-danger";
  if (s === "CANCELLED") return "text-text-muted";
  if (s === "EXECUTING" || s === "OBSERVING") return "text-brand";
  if (s === "PLANNING" || s === "REPLANNING") return "text-info";
  if (s.includes("APPROVAL")) return "text-warning";
  return "text-text-muted";
}

function stateLabel(s: string): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── Conversation event rendering ───────────────────────── */

function ConversationEvent({ event }: { event: EventLike }) {
  const [expanded, setExpanded] = useState(false);
  const p = event.payload as Record<string, unknown> | null;
  const t = event.eventType;
  const time = new Date(event.createdAt).toLocaleTimeString();

  if (t === "PLAN_CREATED") {
    return (
      <div className="rounded-lg border border-info/30 bg-info/5 p-3">
        <div className="flex items-center gap-2 text-info">
          <FileText className="h-3.5 w-3.5" />
          <span className="text-[12px] font-semibold uppercase tracking-wide">Plan Created</span>
          <span className="text-[11px] text-text-muted ml-auto">{time}</span>
        </div>
        {typeof p?.analysis === "string" && (
          <p className="mt-1.5 text-[12px] text-text-secondary leading-relaxed">{p.analysis}</p>
        )}
        {Array.isArray(p?.steps) && (
          <ol className="mt-2 space-y-1">
            {(p.steps as Array<{ title?: string; toolName?: string }>).map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className="mt-px font-mono text-[11px] text-text-muted w-4 shrink-0">{i + 1}.</span>
                <span className="text-text-secondary">{step.title}</span>
                {step.toolName && (
                  <code className="ml-1 rounded bg-surface-3 px-1 py-px text-[11px] text-info font-mono">{step.toolName}</code>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  if (t === "STATE_CHANGED") {
    const to = p?.toState ? String(p.toState).replace(/_/g, " ") : "";
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-text-muted">
        <div className="h-px flex-1 bg-border" />
        <span className="uppercase tracking-wider font-medium">{to}</span>
        <span className="text-[11px]">{time}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (t === "TOOL_STARTED" || t === "TOOL_COMPLETED" || t === "TOOL_FAILED") {
    const toolName = p?.toolName ? String(p.toolName) : p?.name ? String(p.name) : "tool";
    const status = t === "TOOL_COMPLETED" ? "done" : t === "TOOL_FAILED" ? "failed" : "running";
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px]",
        status === "done" && "border-success/20 bg-success/5 text-success",
        status === "failed" && "border-danger/20 bg-danger/5 text-danger",
        status === "running" && "border-brand/20 bg-brand/5 text-brand",
      )}>
        {status === "running" ? <Loader2 className="h-3 w-3 animate-spin shrink-0" /> : status === "done" ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
        <Terminal className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="font-mono text-[11px]">{toolName}</span>
        <span className="ml-auto text-[11px] text-text-muted">{time}</span>
      </div>
    );
  }

  if (t === "RUN_STARTED") return <div className="flex items-center gap-2 py-1.5 text-[11px] text-brand"><Zap className="h-3 w-3" /><span className="font-medium uppercase tracking-wider">Session started</span><span className="text-[11px] text-text-muted ml-auto">{time}</span></div>;
  if (t === "RUN_COMPLETED") return <div className="flex items-center gap-2 py-1.5 text-[11px] text-success"><Check className="h-3 w-3" /><span className="font-medium uppercase tracking-wider">Completed</span><span className="text-[11px] text-text-muted ml-auto">{time}</span></div>;
  if (t === "RUN_FAILED") return <div className="flex items-center gap-2 py-1.5 text-[11px] text-danger"><X className="h-3 w-3" /><span className="font-medium uppercase tracking-wider">Failed</span>{typeof p?.reason === "string" && <span className="text-text-muted">{p.reason}</span>}<span className="text-[11px] text-text-muted ml-auto">{time}</span></div>;
  if (t === "RUN_CANCELLED") return <div className="flex items-center gap-2 py-1.5 text-[11px] text-text-muted"><Square className="h-3 w-3" /><span className="font-medium uppercase tracking-wider">Cancelled</span><span className="text-[11px] ml-auto">{time}</span></div>;
  if (t === "CONTEXT_BUILT") return <div className="flex items-center gap-2 py-1 text-[11px] text-text-muted"><FolderGit2 className="h-3 w-3" /><span>Context assembled</span><span className="text-[11px] ml-auto">{time}</span></div>;
  if (t === "VERIFICATION_STARTED" || t === "VERIFICATION_COMPLETED") return <div className="flex items-center gap-2 py-1 text-[11px] text-state-verifying"><Check className="h-3 w-3" /><span>{t === "VERIFICATION_STARTED" ? "Verifying changes…" : "Verification complete"}</span><span className="text-[11px] text-text-muted ml-auto">{time}</span></div>;
  if (t === "CHECKPOINT_CREATED") return <div className="flex items-center gap-2 py-1 text-[11px] text-text-muted"><FolderGit2 className="h-3 w-3" /><span>Checkpoint created</span><span className="text-[11px] ml-auto">{time}</span></div>;
  if (t === "MODEL_INVOCATION_RECORDED") return <div className="flex items-center gap-2 py-1 text-[11px] text-text-muted"><Cpu className="h-3 w-3" /><span>Model call</span><span className="text-[11px] ml-auto">{time}</span></div>;

  if (p && Object.keys(p).length > 0) {
    return (
      <div className="group">
        <button type="button" onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 py-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors w-full text-left">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span className="uppercase tracking-wide font-medium text-[11px]">{t.replace(/_/g, " ").toLowerCase()}</span>
          <span className="ml-auto text-[11px]">{time}</span>
        </button>
        {expanded && (
          <pre className="ml-5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 font-mono text-[11px] text-text-secondary">
            {JSON.stringify(p, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px] text-text-muted">
      <span className="uppercase tracking-wide">{t.replace(/_/g, " ").toLowerCase()}</span>
      <span className="ml-auto">{time}</span>
    </div>
  );
}

/* ─── Session sidebar item ───────────────────────────────── */

function SessionItem({ task, active, onClick }: { task: TaskDtoLike; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(
      "w-full text-left rounded-md px-2.5 py-2 transition-colors",
      active ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
    )}>
      <p className="truncate text-[12px] font-medium leading-tight">{task.goal}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0",
          ACTIVE_STATES.has(task.state) ? "bg-brand animate-pulse" : task.state === "COMPLETED" ? "bg-success" : task.state === "FAILED" ? "bg-danger" : "bg-text-muted",
        )} />
        <span className="text-[11px] text-text-muted truncate">{task.state.replace(/_/g, " ").toLowerCase()}</span>
        <span className="text-[11px] text-text-muted ml-auto shrink-0">{formatRelative(task.createdAt)}</span>
      </div>
    </button>
  );
}

/* ─── Empty state ────────────────────────────────────────── */

function EmptyWorkspace({ hasProviders, onStartSession }: { hasProviders: boolean; onStartSession: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
      <div className="w-full max-w-lg">
        <h1 className="text-h1">What are you building?</h1>
        <p className="mt-1.5 text-[13px] text-text-secondary leading-relaxed">
          Describe your coding task. The agent will create a plan, ask for your approval, then execute with full visibility.
        </p>
        {!hasProviders && (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-warning">
            Connect a model provider in <Link href="/settings/providers" className="underline hover:text-warning/80">Settings → Providers</Link> to enable agent runs.
          </div>
        )}
        <div className="mt-6 space-y-2">
          {[
            "Add input validation to the signup flow and write tests",
            "Refactor the auth module to use bcrypt instead of argon2",
            "Create a REST endpoint for batch file uploads with progress tracking",
            "Fix the race condition in the concurrent queue processor",
          ].map((example) => (
            <button key={example} type="button" onClick={onStartSession}
              className="w-full rounded-lg border border-border bg-surface-1 px-3.5 py-2.5 text-left text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text-primary group">
              <span className="text-text-muted group-hover:text-brand transition-colors mr-1.5">→</span>
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────── */

export default function AgentWorkspacePage(): ReactNode {
  const qc = useQueryClient();
  const router = useRouter();
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const openFilesRef = useRef<OpenFile[]>([]);

  // Session state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // Sync task selection with URL
  const selectTask = useCallback((id: string | null) => {
    setActiveTaskId(id);
    const params = new URLSearchParams(window.location.search);
    if (id) {
      params.set("task", id);
    } else {
      params.delete("task");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router]);
  const [goal, setGoal] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>("BUILD");

  // Panel state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>("activity");

  // File editor state
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editorView, setEditorView] = useState<"conversation" | "editor">("conversation");

  // File conflict state
  const [, setFileConflicts] = useState<ConflictFile[]>([]);
  const [activeConflict, setActiveConflict] = useState<ConflictFile | null>(null);

  // Keep refs in sync for effects that need latest values without stale closures
  useEffect(() => { openFilesRef.current = openFiles; }, [openFiles]);

  // Responsive layout
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === "mobile";
  const isTablet = breakpoint === "tablet";

  // Auto-collapse panels on smaller screens
  useEffect(() => {
    if (isMobile) {
      setLeftOpen(false);
      setRightOpen(false);
    } else if (isTablet) {
      setLeftOpen(false);
      setRightOpen(true);
    }
  }, [isMobile, isTablet]);

  // Data queries
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: () => apiFetch<WorkspaceDtoLike[]>("/v1/workspaces") });
  const activeWs = workspaceId || workspaces.data?.[0]?.id || "";
  const projects = useQuery({ queryKey: ["projects", activeWs], enabled: Boolean(activeWs), queryFn: () => apiFetch<ProjectStatus[]>(`/v1/workspaces/${activeWs}/projects`) });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => apiFetch<ProviderStatus[]>("/v1/providers") });
  const sessions = useQuery({ queryKey: ["sessions", activeWs], enabled: Boolean(activeWs), queryFn: () => apiFetch<TaskDtoLike[]>(`/v1/tasks?workspaceId=${activeWs}&limit=30`) });

  const activeTask = useQuery({
    queryKey: ["task", activeTaskId], enabled: Boolean(activeTaskId),
    refetchInterval: (q) => { const s = q.state.data?.state; return s && !TERMINAL_STATES.has(s) ? 10000 : false; },
    queryFn: () => apiFetch<TaskDtoLike>(`/v1/tasks/${activeTaskId}`),
  });
  const events = useQuery({ queryKey: ["events", activeTaskId], enabled: Boolean(activeTaskId), refetchInterval: 10000, queryFn: () => apiFetch<EventLike[]>(`/v1/tasks/${activeTaskId}/events?limit=200`) });
  const plans = useQuery({ queryKey: ["plans", activeTaskId], enabled: Boolean(activeTaskId), refetchInterval: 10000, queryFn: () => apiFetch<PlanLike[]>(`/v1/tasks/${activeTaskId}/plans`) });
  const approvals = useQuery({
    queryKey: ["approvals", activeTaskId],
    enabled: Boolean(activeTaskId) && activeTask.data?.state === "WAITING_FOR_TOOL_APPROVAL",
    refetchInterval: 5000,
    queryFn: () => apiFetch<Array<{ id: string; status: string; expiresAt: string; toolCall?: { toolName: string; riskLevel: string; inputSummary: unknown } }>>(`/v1/tasks/${activeTaskId}/approvals`),
  });
  const changes = useQuery({ queryKey: ["changes", activeTaskId], enabled: Boolean(activeTaskId), queryFn: () => apiFetch<ToolCallDto[]>(`/v1/tasks/${activeTaskId}/changes`) });
  const checkpoints = useQuery({ queryKey: ["checkpoints", activeTaskId], enabled: Boolean(activeTaskId), queryFn: () => apiFetch<CheckpointDto[]>(`/v1/tasks/${activeTaskId}/checkpoints`) });
  const verification = useQuery({ queryKey: ["verification", activeTaskId], enabled: Boolean(activeTaskId), queryFn: () => apiFetch<VerificationResultDto[]>(`/v1/tasks/${activeTaskId}/verification`) });

  // Realtime socket
  const invalidateTask = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["task", activeTaskId] });
    void qc.invalidateQueries({ queryKey: ["events", activeTaskId] });
    void qc.invalidateQueries({ queryKey: ["plans", activeTaskId] });
    void qc.invalidateQueries({ queryKey: ["approvals", activeTaskId] });
    void qc.invalidateQueries({ queryKey: ["changes", activeTaskId] });
    void qc.invalidateQueries({ queryKey: ["checkpoints", activeTaskId] });
    void qc.invalidateQueries({ queryKey: ["verification", activeTaskId] });
  }, [activeTaskId, qc]);
  useTaskSocket(activeTaskId, undefined, invalidateTask);

  const taskState = activeTask.data?.state ?? "";
  const draftPlan = (plans.data ?? []).find((p) => p.status === "DRAFT");
  const pendingApprovals = (approvals.data ?? []).filter((a) => a.status === "PENDING");
  const hasProviders = (providers.data ?? []).some((p) => p.status === "ACTIVE");
  const isRunning = Boolean(activeTaskId) && !TERMINAL_STATES.has(taskState) && taskState !== "";
  const currentProject = (projects.data ?? []).find((p) => p.id === projectId);
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<{ action: string; title: string; description: string; variant: "danger" | "warning" } | null>(null);
  const [previewRefreshTrigger, setPreviewRefreshTrigger] = useState(0);

  // Restore activeTaskId from URL query param (?task=...) on mount
  const searchParams = useSearchParams();
  useEffect(() => {
    const taskParam = searchParams.get("task");
    if (taskParam && !activeTaskId) {
      setActiveTaskId(taskParam);
    }
  }, [searchParams, activeTaskId]);

  // Auto-scroll
  useEffect(() => { eventsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.data?.length]);
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // Submit task with mode prefix
  const handleSubmit = useCallback(async () => {
    if (!goal.trim() || !projectId || submitting) return;
    setSubmitting(true); setError(null);
    try {
      if (activeTaskId) {
        // Use the iterate endpoint for follow-up prompts on active tasks
        const r = await apiFetch<{ taskId: string }>("/v1/builder/iterate/" + activeTaskId, {
          method: "POST",
          json: { prompt: goal },
        });
        selectTask(r.taskId); setGoal("");
        qc.invalidateQueries({ queryKey: ["sessions", activeWs] });
      } else {
        const r = await apiFetch<{ id: string }>("/v1/tasks", {
          method: "POST",
          json: { workspaceId: activeWs, projectId, goal, agentMode, selectedModelMode: "ROUTED" },
        });
        selectTask(r.id); setGoal("");
        qc.invalidateQueries({ queryKey: ["sessions", activeWs] });
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create task"); }
    finally { setSubmitting(false); }
  }, [goal, projectId, activeWs, submitting, agentMode, qc, selectTask, activeTaskId]);

  const handlePlanAction = useCallback(async (planId: string, action: "approve" | "reject" | "revise") => {
    try {
      await apiFetch(`/v1/tasks/${activeTaskId}/plans/${planId}/${action}`, { method: "POST", json: {} });
      toast(`Plan ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "revision requested"}`, { variant: action === "reject" ? "warning" : "success" });
    } catch {
      toast(`Failed to ${action} plan`, { variant: "error" });
    }
    qc.invalidateQueries({ queryKey: ["plans", activeTaskId] });
    qc.invalidateQueries({ queryKey: ["task", activeTaskId] });
  }, [activeTaskId, qc, toast]);

  const handleApproval = useCallback(async (id: string, approve: boolean) => {
    try {
      await apiFetch(`/v1/approvals/${id}/${approve ? "approve" : "deny"}`, { method: "POST", json: {} });
      toast(`Tool ${approve ? "allowed" : "denied"}`, { variant: approve ? "success" : "warning" });
    } catch {
      toast(`Failed to ${approve ? "allow" : "deny"} tool`, { variant: "error" });
    }
    qc.invalidateQueries({ queryKey: ["approvals", activeTaskId] });
    qc.invalidateQueries({ queryKey: ["task", activeTaskId] });
  }, [activeTaskId, qc, toast]);

  const handleTaskAction = useCallback(async (action: string) => {
    try {
      await apiFetch(`/v1/tasks/${activeTaskId}/${action}`, { method: "POST", json: {} });
      toast(`${action.charAt(0).toUpperCase() + action.slice(1)} requested`, { variant: "success" });
    } catch {
      toast(`Failed to ${action}`, { variant: "error" });
    }
    qc.invalidateQueries({ queryKey: ["task", activeTaskId] });
  }, [activeTaskId, qc, toast]);

  const handleRollback = useCallback(async (checkpointId: string) => {
    try {
      await apiFetch(`/v1/checkpoints/${checkpointId}/rollback`, { method: "POST", json: { confirm: true } });
      toast("Rolled back to checkpoint", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["task", activeTaskId] });
      qc.invalidateQueries({ queryKey: ["events", activeTaskId] });
      qc.invalidateQueries({ queryKey: ["checkpoints", activeTaskId] });
    } catch {
      toast("Failed to rollback", { variant: "error" });
    }
  }, [activeTaskId, qc, toast]);

  const sortedEvents = useMemo(() => (events.data ?? []).slice().sort((a, b) => a.sequenceNumber - b.sequenceNumber), [events.data]);

  // File editor handlers
  const handleFileSelect = useCallback(async (path: string, content?: string) => {
    // If content not provided, load from API
    let fileContent = content;
    if (!fileContent && projectId) {
      try {
        const result = await apiFetch<{ content: string }>(`/v1/projects/${projectId}/files/read`, {
          method: "POST",
          json: { path },
        });
        fileContent = result.content ?? "";
      } catch {
        toast("Failed to load file", { variant: "error" });
        return;
      }
    }
    fileContent ??= "";

    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.path === path);
      if (existing) {
        // File already open - just switch to it
        setActiveFile(path);
        setEditorView("editor");
        return prev;
      }
      // Detect language from extension
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const langMap: Record<string, string> = {
        ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
        py: "python", json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
        html: "html", css: "css", scss: "scss", sh: "shell", toml: "toml",
      };
      const language = ext === "dockerfile" ? "dockerfile" : ext === "makefile" ? "makefile" : (langMap[ext] ?? "plaintext");
      return [...prev, { path, content: fileContent!, savedContent: fileContent!, dirty: false, language }];
    });
    setActiveFile(path);
    setEditorView("editor");
  }, [projectId, toast]);

  const handleFileUpdate = useCallback((path: string, content: string) => {
    setOpenFiles((prev) => prev.map((f) =>
      f.path === path ? { ...f, content, dirty: content !== f.savedContent } : f,
    ));
  }, []);

  const handleFileSave = useCallback(async (path: string, content: string) => {
    if (!projectId) throw new Error("No project selected");
    try {
      await apiFetch(`/v1/projects/${projectId}/files/write`, {
        method: "POST",
        json: { path, content },
      });
      setOpenFiles((prev) => prev.map((f) =>
        f.path === path ? { ...f, savedContent: content, dirty: false } : f,
      ));
    } catch (err) {
      toast(err instanceof Error ? err.message : "File save failed", { variant: "error" });
    }
  }, [projectId, toast]);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const remaining = prev.filter((f) => f.path !== path);
      setActiveFile((prevActive) => {
        if (prevActive === path) {
          if (remaining.length === 0) setEditorView("conversation");
          return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
        }
        return prevActive;
      });
      return remaining;
    });
  }, []);

  // Detect agent file modifications and handle conflicts
  useEffect(() => {
    if (!projectId || openFilesRef.current.length === 0) return;
    const currentOpenFiles = openFilesRef.current;
    const toolEvents = sortedEvents.filter((e) =>
      e.eventType === "TOOL_COMPLETED" &&
      ((e.payload as Record<string, unknown>)?.toolName === "filesystem.write" ||
       (e.payload as Record<string, unknown>)?.toolName === "filesystem.create" ||
       (e.payload as Record<string, unknown>)?.toolName === "filesystem.delete" ||
       (e.payload as Record<string, unknown>)?.toolName === "filesystem.rename"),
    );
    if (toolEvents.length === 0) return;

    // Auto-refresh preview on file changes
    setPreviewRefreshTrigger((c) => c + 1);

    for (const event of toolEvents) {
      const payload = event.payload as Record<string, unknown>;
      const input = payload.inputSummary as Record<string, unknown> | undefined;
      const toolName = String(payload?.toolName ?? payload?.name ?? "");
      const filePath = String(input?.path ?? input?.filePath ?? "");

      if (toolName === "filesystem.delete" && filePath) {
        // Agent deleted a file — check if it was open
        const openFile = currentOpenFiles.find((f) => f.path === filePath);
        if (openFile) {
          if (openFile.dirty) {
            // Conflict: user has unsaved changes and agent deleted the file
            const conflict: ConflictFile = {
              path: filePath,
              userContent: openFile.content,
              diskContent: "",
              detectedAt: new Date(),
              agentDeleted: true,
            };
            setFileConflicts((prev) => [...prev.filter((c) => c.path !== filePath), conflict]);
            setActiveConflict(conflict);
          } else {
            // No unsaved changes — mark tab as deleted
            setOpenFiles((prev) => prev.map((f) =>
              f.path === filePath ? { ...f, content: "", dirty: false, deleted: true } : f,
            ));
          }
        }
        continue;
      }

      if (toolName === "filesystem.rename" && filePath) {
        // Agent renamed a file — check if the old path was open
        const newPath = String(input?.newPath ?? input?.to ?? "");
        const openFile = currentOpenFiles.find((f) => f.path === filePath);
        if (openFile && newPath) {
          if (openFile.dirty) {
            // Conflict: user has unsaved changes and agent renamed the file
            // Fetch the new file content from disk
            apiFetch<{ content: string }>(`/v1/projects/${projectId}/files/read`, {
              method: "POST",
              json: { path: newPath },
            }).then((result) => {
              const conflict: ConflictFile = {
                path: filePath,
                userContent: openFile.content,
                diskContent: result.content ?? "",
                detectedAt: new Date(),
                agentRenamed: newPath,
              };
              setFileConflicts((prev) => [...prev.filter((c) => c.path !== filePath), conflict]);
              setActiveConflict(conflict);
            }).catch((err) => {
              toast(err instanceof Error ? err.message : "File read failed", { variant: "error" });
            });
          } else {
            // No unsaved changes — update the tab to the new path
            setOpenFiles((prev) => prev.map((f) =>
              f.path === filePath ? { ...f, path: newPath } : f,
            ));
            if (activeFile === filePath) setActiveFile(newPath);
          }
        }
        continue;
      }

      if (toolName === "filesystem.write" || toolName === "filesystem.create") {
        if (!filePath) continue;
        const openFile = currentOpenFiles.find((f) => f.path === filePath);
        if (!openFile) continue;

        if (!openFile.dirty) {
          // File was modified by agent and user has no unsaved changes - reload silently
          void handleFileSelect(filePath);
        } else {
          // File has unsaved user edits AND agent modified it — conflict!
          apiFetch<{ content: string }>(`/v1/projects/${projectId}/files/read`, {
            method: "POST",
            json: { path: filePath },
          }).then((result) => {
            const diskContent = result.content ?? "";
            if (diskContent !== openFile.content) {
              const conflict: ConflictFile = {
                path: filePath,
                userContent: openFile.content,
                diskContent,
                detectedAt: new Date(),
              };
              setFileConflicts((prev) => [...prev.filter((c) => c.path !== filePath), conflict]);
              setActiveConflict(conflict);
            }
          }).catch((err) => {
            toast(err instanceof Error ? err.message : "File read failed", { variant: "error" });
          });
        }
      }
    }
  }, [sortedEvents, projectId]);

  const changedFiles = useMemo(() => {
    const set = new Set<string>();
    (changes.data ?? []).forEach((c) => {
      const input = c.inputSummary as Record<string, unknown> | null;
      if (input?.path) set.add(String(input.path));
    });
    return set;
  }, [changes.data]);

  // Right panel tab config
  const rightTabs: { key: RightTab; label: string; icon: typeof Activity; count?: number }[] = [
    { key: "files", label: "Files", icon: FolderOpen },
    { key: "changes", label: "Changes", icon: Code2, count: changes.data?.length },
    { key: "terminal", label: "Terminal", icon: Terminal },
    { key: "preview", label: "Preview", icon: Globe },
    { key: "deploy", label: "Deploy", icon: Zap },
    { key: "webcontainer", label: "Container", icon: Globe },
    { key: "activity", label: "Activity", icon: Activity, count: events.data?.length },
    { key: "checkpoints", label: "Checkpoints", icon: History, count: checkpoints.data?.length },
    { key: "verification", label: "Verify", icon: Shield, count: verification.data?.length },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      {/* ═══ TOP BAR ═══ */}
      <header className="flex items-center gap-2 border-b border-border bg-surface-1 px-3 py-1 shrink-0 h-10">
        <Link href="/agent" className="flex items-center gap-1.5 text-[13px] font-bold tracking-tight text-text-primary shrink-0">
          <Zap className="h-4 w-4 text-brand" /> {!isMobile && "AI Harness"}
        </Link>
        <div className="h-4 w-px bg-border mx-1" />

        {/* Project info */}
        {currentProject ? (
          <span className="text-[11px] text-text-secondary flex items-center gap-1 truncate">
            <FolderGit2 className="h-3 w-3 text-text-muted shrink-0" />
            {!isMobile && <span className="truncate">{currentProject.name}</span>}
            {!isMobile && <span className="text-text-muted">·</span>}
            {!isMobile && <span className="text-text-muted">{currentProject.connectionType === "LOCAL_BRIDGE" ? "Local" : "Cloud"}</span>}
          </span>
        ) : (
          <span className="text-[11px] text-text-muted">No project selected</span>
        )}

        <div className="flex-1" />

        {/* Model selector */}
        {activeWs && <ModelSelector workspaceId={activeWs} />}

        {/* Agent mode */}
        <div className="flex items-center gap-0.5 mx-1">
          {AGENT_MODES.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setAgentMode(key)}
              className={cn("flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors",
                agentMode === key ? "bg-brand/15 text-brand" : "text-text-muted hover:bg-surface-2 hover:text-text-secondary",
              )} title={AGENT_MODES.find((m) => m.key === key)?.desc}>
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border mx-1" />

        {/* Task state */}
        {activeTask.data && (
          <span className={cn("flex items-center gap-1.5 text-[11px] font-medium", stateColor(taskState))}>
            {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
            {stateLabel(taskState)}
          </span>
        )}

        {/* Task controls */}
        {activeTask.data && (
          <div className="flex items-center gap-0.5">
            {isRunning && (taskState === "EXECUTING" || taskState === "OBSERVING") && (
              <button type="button" onClick={() => void handleTaskAction("pause")} className="rounded p-1 text-text-muted hover:text-warning hover:bg-surface-2 transition-colors" title="Pause">
                <Pause className="h-3 w-3" />
              </button>
            )}
            {taskState === "INTERRUPTED" && (
              <button type="button" onClick={() => void handleTaskAction("resume")} className="rounded p-1 text-text-muted hover:text-info hover:bg-surface-2 transition-colors" title="Resume">
                <Play className="h-3 w-3" />
              </button>
            )}
            {isRunning && (
              <button type="button" onClick={() => setConfirmAction({ action: "cancel", title: "Cancel session?", description: "The agent will stop at the next safe point.", variant: "danger" })} className="rounded p-1 text-text-muted hover:text-danger hover:bg-surface-2 transition-colors" title="Cancel">
                <Square className="h-3 w-3" />
              </button>
            )}
            {TERMINAL_STATES.has(taskState) && (
              <button type="button" onClick={() => setConfirmAction({ action: "retry", title: "Retry session?", description: "Start a new run with the same goal.", variant: "warning" })} className="rounded p-1 text-text-muted hover:text-brand hover:bg-surface-2 transition-colors" title="Retry">
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="h-4 w-px bg-border mx-1" />

        {/* Panel toggles (hidden on mobile, visible on tablet+) */}
        {!isMobile && (
          <>
            <button type="button" onClick={() => setLeftOpen(!leftOpen)}
              className={cn("rounded p-1 transition-colors", leftOpen ? "text-brand bg-brand/10" : "text-text-muted hover:bg-surface-2")}
              aria-label="Toggle left panel">
              {leftOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => setRightOpen(!rightOpen)}
              className={cn("rounded p-1 transition-colors", rightOpen ? "text-brand bg-brand/10" : "text-text-muted hover:bg-surface-2")}
              aria-label="Toggle right panel">
              {rightOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            </button>
          </>
        )}
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── Left sidebar: sessions (hidden on mobile, overlay on tablet) ─── */}
        {leftOpen && !isMobile && (
          <aside className={cn(
            "shrink-0 border-r border-border bg-surface-1 flex flex-col overflow-hidden",
            isTablet ? "absolute inset-y-10 left-0 z-30 w-[260px] shadow-lg" : "w-[220px]",
          )}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Layers className="h-3 w-3 text-text-muted" />
              <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider">Sessions</span>
              <button type="button" onClick={() => { selectTask(null); setGoal(""); setError(null); }}
                className="ml-auto rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-secondary transition-colors" aria-label="New session">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-thin">
              {(sessions.data ?? []).map((task) => (
                <SessionItem key={task.id} task={task} active={task.id === activeTaskId}
                  onClick={() => { selectTask(task.id); setError(null); }} />
              ))}
              {sessions.data?.length === 0 && (
                <p className="px-2.5 py-4 text-center text-[11px] text-text-muted">No sessions yet</p>
              )}
            </div>
            {/* Workspace/Project selectors */}
            <div className="border-t border-border p-2 space-y-1.5">
              <select value={activeWs} onChange={(e) => { setWorkspaceId(e.target.value); setProjectId(""); }}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary appearance-none cursor-pointer">
                {(workspaces.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary appearance-none cursor-pointer">
                <option value="">Select project…</option>
                {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </aside>
        )}

        {/* ─── Center: conversation + composer ─── */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* View toggle when files are open */}
          {openFiles.length > 0 && (
            <div className="flex items-center border-b border-border shrink-0 bg-surface-1">
              <button
                type="button"
                onClick={() => setEditorView("conversation")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors",
                  editorView === "conversation" ? "border-brand text-brand" : "border-transparent text-text-muted hover:text-text-secondary",
                )}
              >
                <Activity className="h-3 w-3" />
                Conversation
              </button>
              <button
                type="button"
                onClick={() => setEditorView("editor")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors",
                  editorView === "editor" ? "border-brand text-brand" : "border-transparent text-text-muted hover:text-text-secondary",
                )}
              >
                <FileCode className="h-3 w-3" />
                Editor
                {openFiles.some((f) => f.dirty) && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
              </button>
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeConflict ? (
              /* Conflict Resolution Panel */
              <ConflictResolutionPanel
                conflict={activeConflict}
                onKeepMine={(path) => {
                  // User keeps their version — dismiss conflict, keep user content in editor
                  setFileConflicts((prev) => prev.filter((c) => c.path !== path));
                  setActiveConflict(null);
                }}
                onUseAgentVersion={(path) => {
                  // User takes agent's disk version
                  if (activeConflict) {
                    handleFileUpdate(path, activeConflict.diskContent);
                    // Update savedContent to match disk so dirty state resets
                    setOpenFiles((prev) => prev.map((f) =>
                      f.path === path ? { ...f, content: activeConflict.diskContent, savedContent: activeConflict.diskContent, dirty: false } : f,
                    ));
                    setFileConflicts((prev) => prev.filter((c) => c.path !== path));
                    setActiveConflict(null);
                  }
                }}
                onSaveAs={(newPath, content) => {
                  // Save user version as a new file
                  if (projectId) {
                    const conflictPath = activeConflict?.path;
                    apiFetch(`/v1/projects/${projectId}/files/write`, {
                      method: "POST",
                      json: { path: newPath, content },
                    }).then(() => {
                      toast(`Saved as ${newPath.split("/").pop()}`, { variant: "success" });
                      if (conflictPath) {
                        setFileConflicts((prev) => prev.filter((c) => c.path !== conflictPath));
                      }
                      setActiveConflict(null);
                    }).catch((err: unknown) => {
                      toast(err instanceof Error ? err.message : "File save failed", { variant: "error" });
                    });
                  }
                }}
                onDismiss={(path) => {
                  // Close without resolving — dismiss conflict, keep user content unsaved
                  setFileConflicts((prev) => prev.filter((c) => c.path !== path));
                  setActiveConflict(null);
                }}
              />
            ) : editorView === "editor" && openFiles.length > 0 ? (
              <CodeEditor
                projectId={projectId || null}
                files={openFiles}
                activeFile={activeFile}
                onFileUpdate={handleFileUpdate}
                onFileSave={handleFileSave}
                onFileClose={closeFile}
                onActiveChange={setActiveFile}
              />
            ) : (
              <div className="h-full overflow-y-auto scrollbar-thin">
                {!activeTaskId ? (
                  <EmptyWorkspace hasProviders={hasProviders} onStartSession={() => textareaRef.current?.focus()} />
                ) : (
                  <div className="mx-auto max-w-3xl px-4 py-4 space-y-3">
                    {/* User goal */}
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg bg-brand/10 border border-brand/20 px-3.5 py-2.5 text-[13px] text-text-primary">
                        {activeTask.data?.goal}
                      </div>
                    </div>

                    {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2 text-[12px] text-danger">{error}</div>}

                    {/* Plan approval */}
                    {draftPlan && taskState === "WAITING_FOR_APPROVAL" && (
                      <div className="rounded-lg border border-info/30 bg-info/5 p-4">
                        <div className="flex items-center gap-2 text-info mb-2">
                          <FileText className="h-3.5 w-3.5" />
                          <span className="text-[12px] font-semibold uppercase tracking-wide">Plan v{draftPlan.version}</span>
                        </div>
                        <p className="text-[12px] text-text-secondary leading-relaxed">{draftPlan.analysis}</p>
                        <ol className="mt-2 space-y-1">
                          {draftPlan.steps.map((s, i) => (
                            <li key={s.id} className="flex items-start gap-2 text-[12px]">
                              <span className="mt-px font-mono text-[11px] text-text-muted w-4 shrink-0">{i + 1}.</span>
                              <span className="text-text-secondary">{s.title}</span>
                              {s.toolName && <code className="ml-1 rounded bg-surface-3 px-1 py-px text-[11px] text-info font-mono">{s.toolName}</code>}
                            </li>
                          ))}
                        </ol>
                        {draftPlan.risks && draftPlan.risks.length > 0 && (
                          <div className="mt-2">
                            <p className="text-[11px] uppercase tracking-wider text-text-muted mb-1">Risks</p>
                            {draftPlan.risks.map((r, i) => <p key={i} className="text-[11px] text-warning/80">• {r}</p>)}
                          </div>
                        )}
                        <div className="mt-3 flex gap-2">
                          <button type="button" onClick={() => void handlePlanAction(draftPlan.id, "approve")}
                            className="inline-flex items-center gap-1.5 rounded-md bg-success/15 border border-success/30 px-3 py-1.5 text-[11px] font-medium text-success hover:bg-success/25 transition-colors">
                            <Check className="h-3 w-3" /> Approve & Run
                          </button>
                          <button type="button" onClick={() => void handlePlanAction(draftPlan.id, "revise")}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-3 transition-colors">
                            Request revision
                          </button>
                          <button type="button" onClick={() => void handlePlanAction(draftPlan.id, "reject")}
                            className="inline-flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/5 px-3 py-1.5 text-[11px] font-medium text-danger hover:bg-danger/15 transition-colors">
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tool approvals */}
                    {pendingApprovals.map((a) => (
                      <div key={a.id} className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                        <div className="flex items-center gap-2 text-warning mb-2">
                          <Terminal className="h-3.5 w-3.5" />
                          <span className="text-[12px] font-semibold">{a.toolCall?.toolName ?? "Tool"} — needs permission</span>
                          <span className="ml-auto text-[11px] text-text-muted">Expires {new Date(a.expiresAt).toLocaleTimeString()}</span>
                        </div>
                        {a.toolCall?.inputSummary != null && (
                          <pre className="max-h-32 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px] text-text-secondary">
                            {JSON.stringify(a.toolCall.inputSummary, null, 2)}
                          </pre>
                        )}
                        <div className="mt-3 flex gap-2">
                          <button type="button" onClick={() => void handleApproval(a.id, true)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-success/15 border border-success/30 px-3 py-1.5 text-[11px] font-medium text-success hover:bg-success/25 transition-colors">
                            <Check className="h-3 w-3" /> Allow
                          </button>
                          <button type="button" onClick={() => void handleApproval(a.id, false)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/5 px-3 py-1.5 text-[11px] font-medium text-danger hover:bg-danger/15 transition-colors">
                            Deny
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Event stream */}
                    {sortedEvents.map((event) => <ConversationEvent key={event.id} event={event} />)}

                    {isRunning && (
                      <div className="flex items-center gap-2 py-2 text-[11px] text-text-muted">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Agent working…</span>
                      </div>
                    )}

                    <div ref={eventsEndRef} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Composer ─── */}
          <div className="border-t border-border bg-surface-1 p-3 shrink-0">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-end gap-2 rounded-lg border border-border-strong bg-surface-2 p-2 focus-within:border-brand/50 transition-colors">
                <textarea ref={textareaRef} rows={1} value={goal}
                  onChange={(e) => { setGoal(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && goal.trim() && projectId) { e.preventDefault(); void handleSubmit(); } }}
                  placeholder={activeTaskId ? "Continue with…" : "Describe your coding task…"}
                  className="flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-text-primary outline-none placeholder:text-text-muted min-h-[24px] max-h-[160px]"
                  disabled={submitting} />
                <button type="button" onClick={() => void handleSubmit()}
                  disabled={!goal.trim() || !projectId || submitting}
                  className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-all",
                    goal.trim() && projectId ? "bg-brand text-white hover:bg-brand-hover shadow-sm" : "bg-surface-3 text-text-disabled cursor-not-allowed",
                  )}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-muted">
                <span><kbd className="rounded border border-border bg-surface-3 px-1 py-px font-mono">Enter</kbd> submit</span>
                <span><kbd className="rounded border border-border bg-surface-3 px-1 py-px font-mono">Shift+Enter</kbd> new line</span>
                <span className="ml-auto flex items-center gap-1">
                  <FolderGit2 className="h-3 w-3" />
                  {currentProject?.name ?? "No project"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Right panel ─── */}
        {rightOpen && !isMobile && (
          <aside className={cn(
            "shrink-0 border-l border-border bg-surface-1 flex flex-col overflow-hidden",
            isTablet ? "absolute inset-y-10 right-0 z-30 w-[300px] shadow-lg" : "w-[340px]",
          )}>
            {/* Tab bar */}
            <div className="flex border-b border-border shrink-0 overflow-x-auto">
              {rightTabs.map(({ key, label, icon: Icon, count }) => (
                <button key={key} type="button" onClick={() => setRightTab(key)}
                  className={cn("flex items-center gap-1 px-2.5 py-2 text-[11px] font-medium transition-colors border-b-2 -mb-px shrink-0",
                    rightTab === key ? "border-brand text-brand" : "border-transparent text-text-muted hover:text-text-secondary",
                  )}>
                  <Icon className="h-3 w-3" />
                  {label}
                  {count !== undefined && count > 0 && (
                    <span className="ml-0.5 rounded-full bg-surface-3 px-1.5 text-[11px] text-text-muted">{count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {rightTab === "files" && (
                <FileExplorer
                  projectId={projectId || null}
                  onFileSelect={handleFileSelect}
                  activeFile={activeFile ?? undefined}
                  changedFiles={changedFiles}
                />
              )}

              {rightTab === "terminal" && (
                <TerminalComponent projectId={projectId || null} />
              )}

              {rightTab === "preview" && (
                <PreviewPanel
                  projectId={projectId || null}
                  taskState={taskState}
                  refreshTrigger={previewRefreshTrigger}
                  onInspectElement={(el) => {
                    if (!projectId) return;
                    const q = encodeURIComponent(JSON.stringify({
                      action: "inspect",
                      element: el,
                    }));
                    void router.push(`/agent?project=${projectId}&instruction=${q}`);
                  }}
                />
              )}

              {rightTab === "deploy" && (
                <DeployPanel projectId={projectId} />
              )}

              {rightTab === "webcontainer" && (
                <WebContainerPanel workspaceId={workspaceId || ""} />
              )}

              {rightTab === "activity" && (
                <div className="p-3 space-y-2 overflow-y-auto h-full scrollbar-thin">
                  {sortedEvents.length === 0 ? (
                    <p className="text-center text-[11px] text-text-muted py-8">No activity yet</p>
                  ) : (
                    sortedEvents.slice().reverse().map((e) => <ConversationEvent key={e.id} event={e} />)
                  )}
                </div>
              )}

              {rightTab === "changes" && (
                <div className="p-3 space-y-2 overflow-y-auto h-full scrollbar-thin">
                  {(changes.data ?? []).length === 0 ? (
                    <p className="text-center text-[11px] text-text-muted py-8">No file changes yet</p>
                  ) : (
                    (changes.data ?? []).map((c) => {
                      const input = c.inputSummary as Record<string, unknown> | null;
                      const output = c.resultSummary as Record<string, unknown> | null;
                      const filePath = input?.path ?? input?.filePath ?? null;
                      const isFileOp = ["write_file", "edit_file", "create_file"].includes(c.toolName);
                      return (
                        <div key={c.id} className="rounded-md border border-border bg-surface-2 p-2.5">
                          <div className="flex items-center gap-2">
                            {isFileOp ? <FileText className="h-3 w-3 text-info shrink-0" /> : <Terminal className="h-3 w-3 text-text-muted shrink-0" />}
                            {typeof filePath === "string" ? (
                              <span className="font-mono text-[11px] font-medium text-text-primary truncate" title={filePath}>{filePath}</span>
                            ) : (
                              <span className="font-mono text-[11px] font-medium">{c.toolName}</span>
                            )}
                            <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium shrink-0",
                              c.status === "SUCCEEDED" ? "bg-success/15 text-success" : c.status === "FAILED" ? "bg-danger/15 text-danger" : "bg-surface-3 text-text-muted",
                            )}>{c.status}</span>
                          </div>
                          {c.inputSummary != null && (
                            <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-surface-1 p-1.5 font-mono text-[11px] text-text-muted">
                              {typeof c.inputSummary === "string" ? c.inputSummary.slice(0, 300) : JSON.stringify(c.inputSummary, null, 2).slice(0, 300)}
                            </pre>
                          )}
                          {output != null && (
                            <pre className="mt-1 max-h-20 overflow-auto rounded bg-surface-1 p-1.5 font-mono text-[11px] text-success/70">
                              {typeof output === "object" ? JSON.stringify(output, null, 2).slice(0, 300) : String(output).slice(0, 300)}
                            </pre>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {rightTab === "checkpoints" && (
                <div className="p-3 space-y-2 overflow-y-auto h-full scrollbar-thin">
                  {(checkpoints.data ?? []).length === 0 ? (
                    <p className="text-center text-[11px] text-text-muted py-8">No checkpoints created</p>
                  ) : (
                    (checkpoints.data ?? []).map((cp) => (
                      <div key={cp.id} className="rounded-md border border-border bg-surface-2 p-2.5">
                        <div className="flex items-center gap-2">
                          <History className="h-3 w-3 text-text-muted shrink-0" />
                          <span className="text-[11px] font-medium">{cp.checkpointType.replace(/_/g, " ")}</span>
                          <span className="ml-auto text-[11px] text-text-muted">{new Date(cp.createdAt).toLocaleTimeString()}</span>
                        </div>
                        {cp.stateReference != null && (
                          <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-surface-1 p-1.5 font-mono text-[11px] text-text-muted">
                            {JSON.stringify(cp.stateReference, null, 2)}
                          </pre>
                        )}
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setConfirmAction({
                              action: `rollback:${cp.id}`,
                              title: "Rollback to checkpoint?",
                              description: "This will overwrite current changes and restore the project to this checkpoint state.",
                              variant: "danger",
                            })}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-text-muted hover:text-warning hover:bg-surface-1 transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Rollback
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {rightTab === "verification" && (
                <div className="p-3 space-y-2 overflow-y-auto h-full scrollbar-thin">
                  {(verification.data ?? []).length === 0 ? (
                    <p className="text-center text-[11px] text-text-muted py-8">No verification results</p>
                  ) : (
                    (verification.data ?? []).map((v) => (
                      <div key={v.id} className="rounded-md border border-border bg-surface-2 p-2.5">
                        <div className="flex items-center gap-2">
                          <Shield className="h-3 w-3 text-text-muted shrink-0" />
                          <span className="font-mono text-[11px]">{v.command}</span>
                          <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium",
                            v.status === "PASSED" ? "bg-success/15 text-success" : v.status === "FAILED" ? "bg-danger/15 text-danger" : "bg-surface-3 text-text-muted",
                          )}>{v.status}</span>
                        </div>
                        {v.outputReference && (
                          <p className="mt-1 text-[11px] text-text-muted font-mono">{v.outputReference}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* File editor tabs */}
      <FileTabBar
        files={openFiles}
        activeFile={activeFile}
        onTabClick={setActiveFile}
        onTabClose={closeFile}
      />

      {/* Mobile bottom navigation */}
      {isMobile && (
        <div className="flex items-center border-t border-border bg-surface-1 shrink-0">
          <button
            type="button"
            onClick={() => { setLeftOpen(!leftOpen); setRightOpen(false); }}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              leftOpen ? "text-brand" : "text-text-muted",
            )}
          >
            <Layers className="h-4 w-4" />
            <span>Sessions</span>
          </button>
          <button
            type="button"
            onClick={() => { setLeftOpen(false); setRightOpen(false); setEditorView("conversation"); }}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              !leftOpen && !rightOpen && editorView === "conversation" ? "text-brand" : "text-text-muted",
            )}
          >
            <Activity className="h-4 w-4" />
            <span>Chat</span>
          </button>
          <button
            type="button"
            onClick={() => { setLeftOpen(false); setRightOpen(false); setEditorView("editor"); }}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              editorView === "editor" ? "text-brand" : "text-text-muted",
            )}
          >
            <Code2 className="h-4 w-4" />
            <span>Editor</span>
          </button>
          <button
            type="button"
            onClick={() => { setLeftOpen(false); setRightOpen(!rightOpen); }}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              rightOpen ? "text-brand" : "text-text-muted",
            )}
          >
            <Activity className="h-4 w-4" />
            <span>Activity</span>
          </button>
          <button
            type="button"
            onClick={() => { setLeftOpen(false); setRightOpen(false); setRightTab("terminal"); setRightOpen(true); }}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              rightTab === "terminal" && rightOpen ? "text-brand" : "text-text-muted",
            )}
          >
            <Terminal className="h-4 w-4" />
            <span>Terminal</span>
          </button>
        </div>
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={confirmAction?.title ?? ""}
        description={confirmAction?.description ?? ""}
        confirmLabel={confirmAction?.action === "cancel" ? "Cancel session" : confirmAction?.action.startsWith("rollback:") ? "Rollback" : "Retry"}
        variant={confirmAction?.variant ?? "danger"}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.action.startsWith("rollback:")) {
            const cpId = confirmAction.action.split(":")[1];
            void handleRollback(cpId);
          } else {
            void handleTaskAction(confirmAction.action);
          }
          setConfirmAction(null);
        }}
      />
    </div>
  );
}
