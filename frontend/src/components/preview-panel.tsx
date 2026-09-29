"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Square,
  ExternalLink,
  RefreshCw,
  Monitor,
  Tablet,
  Smartphone,
  AlertCircle,
  Globe,
  Loader2,
  RotateCcw,
  MousePointer2,
  Send,
  Terminal,
  Wifi,
  WifiOff,
  Clock,
} from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { getSocket } from "@/lib/use-task-socket";

interface PreviewPanelProps {
  projectId: string | null;
  taskState?: string;
  onInspectElement?: (element: InspectedElement) => void;
  refreshTrigger?: number;
}

interface PreviewState {
  active: boolean;
  id?: string;
  command?: string;
  port?: number;
  status?: string;
  url?: string;
  startedAt?: string;
  logs?: string;
}

interface DetectedPreview {
  detected: boolean;
  command: string;
  port: number;
  framework?: string;
  reason: string;
}

interface InspectedElement {
  tagName: string;
  className: string;
  id: string;
  textContent: string;
  outerHTML: string;
  selector: string;
}

type ViewportSize = "desktop" | "tablet" | "mobile";

const VIEWPORT_WIDTHS: Record<ViewportSize, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

export function PreviewPanel({ projectId, taskState, onInspectElement, refreshTrigger }: PreviewPanelProps) {
  const [viewport, setViewport] = useState<ViewportSize>("desktop");
  const [command, setCommand] = useState("npm run dev");
  const [port, setPort] = useState(3000);
  const [showSetup, setShowSetup] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<InspectedElement | null>(null);
  const [inspectInstruction, setInspectInstruction] = useState("");
  const [iframeKey, setIframeKey] = useState(0);
  const [crashCount, setCrashCount] = useState(0);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const preview = useQuery({
    queryKey: ["preview", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<PreviewState>(`/v1/projects/${projectId}/preview`),
    refetchInterval: 30_000,
  });

  // Socket push: invalidate preview immediately when server pushes preview:* events (fallback polling remains at 30s)
  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    try {
      const socket = getSocket();
      const handler = (payload: unknown) => {
        if (!mounted) return;
        const p = payload as { projectId?: string; previewProjectId?: string; type?: string };
        const pid = p?.projectId ?? p?.previewProjectId;
        if (!pid || pid === projectId) {
          void qc.invalidateQueries({ queryKey: ["preview", projectId] });
        }
      };
      socket.on("preview:status", handler);
      socket.on("preview:update", handler);
      return () => {
        mounted = false;
        socket.off("preview:status", handler);
        socket.off("preview:update", handler);
      };
    } catch {
      // Socket not yet initialized (e.g. SSR) — polling fallback covers updates
      return;
    }
  }, [projectId, qc]);

  const detection = useQuery({
    queryKey: ["preview-detect", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<DetectedPreview>(`/v1/projects/${projectId}/preview/detect`),
  });

  const isActive = preview.data?.active && preview.data.status === "running";
  const isError = preview.data?.status === "error";
  const isStarting = preview.data?.status === "starting";

  // Remote vs local detection: preview URL is always http://localhost:<port> on the bridge host.
  // When the browser is on a different machine, a direct fetch/iframe to localhost will fail —
  // remote previews are served through the bridge proxy (GET .../preview/proxy/* with a
  // short-lived ticket; see projects.preview-proxy.ts).
  const isRemotePreview = (() => {
    if (typeof window === "undefined" || !preview.data?.url) return false;
    const url = preview.data.url;
    const isLocalhostUrl = url.includes("localhost") || url.includes("127.0.0.1");
    if (!isLocalhostUrl) return false;
    const host = window.location.hostname;
    return host !== "localhost" && host !== "127.0.0.1" && host !== "";
  })();

  // Proxy ticket (project-bound, ~2h TTL) — iframes cannot send Authorization headers.
  const proxyTicket = useQuery({
    queryKey: ["preview-proxy-ticket", projectId],
    queryFn: () =>
      apiFetch<{ ticket: string; expiresAt: string }>(`/v1/projects/${projectId}/preview/proxy-ticket`, {
        method: "POST",
      }),
    enabled: Boolean(projectId) && isRemotePreview && isActive,
    staleTime: 60 * 60_000, // refresh hourly — well inside the 2h ticket TTL
    retry: 1,
  });

  const proxiedPreviewUrl =
    isRemotePreview && proxyTicket.data
      ? `${apiUrl}/v1/projects/${projectId}/preview/proxy/?ticket=${encodeURIComponent(proxyTicket.data.ticket)}`
      : null;
  const iframeSrc = proxiedPreviewUrl ?? preview.data?.url ?? "";

  // Auto-refresh preview when file changes are detected
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0 && isActive) {
      setIframeKey((k) => k + 1);
    }
  }, [refreshTrigger, isActive]);

  // Health check (remote browsers probe through the proxy; local directly)
  const health = useQuery({
    queryKey: ["preview-health", projectId, proxiedPreviewUrl],
    enabled: Boolean(projectId) && Boolean(preview.data?.url) && (!isRemotePreview || Boolean(proxiedPreviewUrl)),
    queryFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(proxiedPreviewUrl ?? preview.data!.url!, { method: "HEAD", mode: "no-cors" });
        return {
          reachable: true,
          statusCode: res.status,
          responseTime: Date.now() - start,
          lastChecked: new Date().toISOString(),
        };
      } catch (err) {
        console.error("[Preview] Health check failed:", err);
        return {
          responseTime: Date.now() - start,
          lastChecked: new Date().toISOString(),
        };
      }
    },
    refetchInterval: 10000,
  });

  // Update command/port when detection completes
  useEffect(() => {
    if (detection.data?.detected) {
      setCommand(detection.data.command);
      setPort(detection.data.port);
    }
  }, [detection.data]);

  // Auto-reload iframe when preview status changes to running
  useEffect(() => {
    if (preview.data?.status === "running" && preview.data.url) {
      setIframeKey((k) => k + 1);
    }
  }, [preview.data?.status, preview.data?.url]);

  // Reset crash count when preview is running
  useEffect(() => {
    if (preview.data?.status === "running") {
      setCrashCount(0);
    }
  }, [preview.data?.status]);

  // Capture console logs from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "ai-harness-console") {
        setConsoleLogs((prev) => [...prev.slice(-100), `[${new Date().toLocaleTimeString()}] ${e.data.level}: ${e.data.message}`]);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Inject console capture into iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !isActive) return;

    const injectConsoleCapture = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;

        const existing = doc.getElementById("ai-harness-console-capture");
        if (existing) existing.remove();

        const script = doc.createElement("script");
        script.id = "ai-harness-console-capture";
        script.textContent = `
          (function() {
            const origLog = console.log;
            const origError = console.error;
            const origWarn = console.warn;
            console.log = function() {
              window.parent.postMessage({ type: 'ai-harness-console', level: 'log', message: Array.from(arguments).join(' ') }, window.location.origin);
              origLog.apply(console, arguments);
            };
            console.error = function() {
              window.parent.postMessage({ type: 'ai-harness-console', level: 'error', message: Array.from(arguments).join(' ') }, window.location.origin);
              origError.apply(console, arguments);
            };
            console.warn = function() {
              window.parent.postMessage({ type: 'ai-harness-console', level: 'warn', message: Array.from(arguments).join(' ') }, window.location.origin);
              origWarn.apply(console, arguments);
            };
            window.onerror = function(msg, url, line, col, error) {
              window.parent.postMessage({ type: 'ai-harness-console', level: 'error', message: msg + ' at ' + url + ':' + line }, window.location.origin);
            };
          })();
        `;
        doc.head.appendChild(script);
      } catch (err) {
        console.error("[Preview] Cross-origin console capture:", err);
      }
    };

    iframe.addEventListener("load", injectConsoleCapture);
    return () => iframe.removeEventListener("load", injectConsoleCapture);
  }, [isActive, iframeKey]);

  const startPreview = useCallback(async () => {
    if (!projectId) return;
    try {
      await apiFetch(`/v1/projects/${projectId}/preview/start`, {
        method: "POST",
        json: { command, port },
      });
      toast("Preview started", { variant: "success" });
      void qc.invalidateQueries({ queryKey: ["preview", projectId] });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to start preview", { variant: "error" });
    }
  }, [projectId, command, port, qc, toast]);

  const stopPreview = useCallback(async () => {
    if (!projectId) return;
    try {
      await apiFetch(`/v1/projects/${projectId}/preview/stop`, { method: "POST" });
      toast("Preview stopped", { variant: "success" });
      void qc.invalidateQueries({ queryKey: ["preview", projectId] });
      setConsoleLogs([]);
    } catch (err) {
      console.error("[Preview] Failed to stop preview:", err);
      toast("Failed to stop preview", { variant: "error" });
    }
  }, [projectId, qc, toast]);

  const restartPreview = useCallback(async () => {
    if (!projectId) return;
    try {
      await apiFetch(`/v1/projects/${projectId}/preview/restart`, { method: "POST" });
      void qc.invalidateQueries({ queryKey: ["preview", projectId] });
    } catch (err) {
      console.error("[Preview] Failed to restart preview:", err);
      toast("Failed to restart preview", { variant: "error" });
    }
  }, [projectId, qc, toast]);

  // Auto-start preview when task completes
  useEffect(() => {
    if (
      taskState === "COMPLETED" &&
      projectId &&
      !preview.data?.active &&
      !autoStarted &&
      detection.data?.detected
    ) {
      setAutoStarted(true);
      void startPreview();
    }
  }, [taskState, projectId, preview.data?.active, autoStarted, detection.data, startPreview]);

  // Auto-restart on crash detection
  useEffect(() => {
    if (preview.data?.status === "error" && crashCount < 3 && projectId) {
      const timer = setTimeout(() => {
        setCrashCount((c) => c + 1);
        void restartPreview();
        toast(`Preview crashed. Auto-restarting... (attempt ${crashCount + 1}/3)`, { variant: "warning" });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [preview.data?.status, crashCount, projectId, restartPreview, toast]);

  // Inject inspect handler into iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !inspectMode || !isActive) return;

    const injectInspect = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;

        const existingScript = doc.getElementById("ai-harness-inspect");
        if (existingScript) existingScript.remove();

        const style = doc.createElement("style");
        style.id = "ai-harness-inspect-styles";
        style.textContent = `
          .ai-harness-inspect-overlay { position: fixed; pointer-events: none; z-index: 999999; border: 2px solid #5b8cff; background: rgba(91, 140, 255, 0.1); transition: all 0.1s ease; }
          .ai-harness-inspect-label { position: fixed; z-index: 999999; background: #5b8cff; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: monospace; pointer-events: none; white-space: nowrap; }
        `;
        doc.head.appendChild(style);

        const overlay = doc.createElement("div");
        overlay.className = "ai-harness-inspect-overlay";
        overlay.style.display = "none";
        doc.body.appendChild(overlay);

        const label = doc.createElement("div");
        label.className = "ai-harness-inspect-label";
        label.style.display = "none";
        doc.body.appendChild(label);

        const handleMouseMove = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (!target || target === doc.body || target === doc.documentElement) return;
          const rect = target.getBoundingClientRect();
          overlay.style.left = `${rect.left}px`;
          overlay.style.top = `${rect.top}px`;
          overlay.style.width = `${rect.width}px`;
          overlay.style.height = `${rect.height}px`;
          overlay.style.display = "block";
          const tagName = target.tagName.toLowerCase();
          const className = target.className ? `.${String(target.className).split(" ")[0]}` : "";
          label.textContent = `${tagName}${className}`;
          label.style.left = `${rect.left}px`;
          label.style.top = `${rect.top - 24}px`;
          label.style.display = "block";
        };

        const handleClick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target as HTMLElement;
          if (!target || target === doc.body || target === doc.documentElement) return;

          const path: string[] = [];
          let current: HTMLElement | null = target;
          while (current && current !== doc.body) {
            let part = current.tagName.toLowerCase();
            if (current.id) { part = `#${current.id}`; path.unshift(part); break; }
            else if (current.className && typeof current.className === "string") part += `.${current.className.split(" ")[0]}`;
            path.unshift(part);
            current = current.parentElement;
          }

          const element: InspectedElement = {
            tagName: target.tagName.toLowerCase(),
            className: typeof target.className === "string" ? target.className : "",
            id: target.id,
            textContent: target.textContent?.slice(0, 200) ?? "",
            outerHTML: target.outerHTML.slice(0, 1000),
            selector: path.join(" > "),
          };
          window.postMessage({ type: "ai-harness-inspect", element }, window.location.origin);
          overlay.style.display = "none";
          label.style.display = "none";
        };

        doc.addEventListener("mousemove", handleMouseMove, true);
        doc.addEventListener("click", handleClick, true);

        (window as unknown as Record<string, unknown>).__aiHarnessCleanup = () => {
          doc.removeEventListener("mousemove", handleMouseMove, true);
          doc.removeEventListener("click", handleClick, true);
          overlay.remove();
          label.remove();
          style.remove();
        };
      } catch (err) {
        console.error("[Preview] Cross-origin inspect injection:", err);
      }
    };

    iframe.addEventListener("load", injectInspect);
    return () => {
      iframe.removeEventListener("load", injectInspect);
      try {
        const cleanup = (window as unknown as Record<string, unknown>).__aiHarnessCleanup;
        if (typeof cleanup === "function") cleanup();
      } catch (err) {
        console.error("[Preview] Cleanup function error:", err);
      }
    };
  }, [inspectMode, isActive]);

  // Listen for inspect messages
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "ai-harness-inspect" && e.data.element) {
        setSelectedElement(e.data.element);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleSendInspection = useCallback(() => {
    if (!selectedElement || !inspectInstruction.trim()) return;
    onInspectElement?.({
      ...selectedElement,
      textContent: `${selectedElement.textContent}\n\nUser instruction: ${inspectInstruction}`,
    });
    setInspectInstruction("");
    setSelectedElement(null);
    setInspectMode(false);
    toast("Inspect instruction sent to AI", { variant: "success" });
  }, [selectedElement, inspectInstruction, onInspectElement, toast]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <Globe className="h-3 w-3 text-text-muted" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Preview</span>

        {detection.data?.framework && detection.data.framework !== "Unknown" && (
          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-muted font-mono">
            {detection.data.framework}
          </span>
        )}

        {/* Health indicator */}
        {isActive && health.data && (
          <div className={cn("flex items-center gap-1 text-[11px]", health.data.reachable ? "text-success" : "text-danger")}>
            {health.data.reachable ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
            {health.data.reachable ? (
              <span>{health.data.responseTime}ms</span>
            ) : (
              <span>Unreachable</span>
            )}
          </div>
        )}

        {/* Inspect mode toggle */}
        {isActive && (
          <button
            type="button"
            onClick={() => { setInspectMode(!inspectMode); setSelectedElement(null); setInspectInstruction(""); }}
            className={cn("rounded p-1 transition-colors", inspectMode ? "text-brand bg-brand/10" : "text-text-muted hover:text-text-secondary hover:bg-surface-2")}
            title={inspectMode ? "Exit inspect mode" : "Inspect element"}
            aria-label={inspectMode ? "Exit inspect mode" : "Inspect element"}
          >
            <MousePointer2 className="h-3 w-3" />
          </button>
        )}

        {/* Console toggle */}
        {isActive && (
          <button
            type="button"
            onClick={() => setShowConsole(!showConsole)}
            className={cn("rounded p-1 transition-colors", showConsole ? "text-brand bg-brand/10" : "text-text-muted hover:text-text-secondary hover:bg-surface-2")}
            title="Console logs"
            aria-label="Toggle console logs"
          >
            <Terminal className="h-3 w-3" />
          </button>
        )}

        <div className="flex-1" />

        {/* Status indicator */}
        {isStarting && (
          <div className="flex items-center gap-1.5 text-[11px] text-brand">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Starting...</span>
          </div>
        )}
        {isActive && (
          <div className="flex items-center gap-1.5 text-[11px] text-success">
            <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            <span>Live</span>
          </div>
        )}

        {/* Viewport toggles */}
        {isActive && (
          <div className="flex items-center gap-0.5 mr-1">
            {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([size, Icon]) => (
              <button
                key={size}
                type="button"
                onClick={() => setViewport(size)}
                className={cn("rounded p-1 transition-colors", viewport === size ? "text-brand bg-brand/10" : "text-text-muted hover:text-text-secondary")}
                title={size}
                aria-label={`${size} viewport`}
                aria-pressed={viewport === size}
              >
                <Icon className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        {isActive ? (
          <>
            {preview.data?.url && (
              <a href={preview.data.url} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors" title="Open in new tab">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <button type="button" onClick={() => void restartPreview()} className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors" title="Restart preview">
              <RotateCcw className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => { void qc.invalidateQueries({ queryKey: ["preview", projectId] }); setIframeKey((k) => k + 1); }} className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors" title="Refresh">
              <RefreshCw className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => void stopPreview()} className="rounded p-1 text-danger hover:bg-danger/10 transition-colors" title="Stop preview">
              <Square className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setShowSetup(!showSetup)} className="rounded p-1 text-success hover:bg-success/10 transition-colors" title="Start preview">
            <Play className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Setup panel */}
      {showSetup && !isActive && (
        <div className="px-3 py-2 border-b border-border shrink-0 space-y-2">
          <div>
            <label className="text-[11px] uppercase text-text-muted">Command</label>
            <input value={command} onChange={(e) => setCommand(e.target.value)} className="mt-0.5 w-full rounded bg-surface-2 px-2 py-1 text-[11px] font-mono text-text-primary outline-none border border-border focus:border-brand" placeholder="npm run dev" />
          </div>
          <div>
            <label className="text-[11px] uppercase text-text-muted">Port</label>
            <input type="number" value={port} min={1} max={65535} onChange={(e) => { const v = Number(e.target.value); if (v > 0 && v <= 65535) setPort(v); }} className="mt-0.5 w-full rounded bg-surface-2 px-2 py-1 text-[11px] font-mono text-text-primary outline-none border border-border focus:border-brand" />
          </div>
          <Button size="sm" className="w-full" onClick={() => { void startPreview(); setShowSetup(false); }}>Start Preview</Button>
        </div>
      )}

      {/* Inspect mode indicator */}
      {inspectMode && isActive && !selectedElement && (
        <div className="px-3 py-2 border-b border-brand/30 bg-brand/5 shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-brand">
            <MousePointer2 className="h-3 w-3" />
            <span>Click any element in the preview to inspect it</span>
          </div>
        </div>
      )}

      {/* Selected element panel */}
      {selectedElement && (
        <div className="px-3 py-2 border-b border-border shrink-0 space-y-2 bg-surface-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wide">Selected</span>
            <code className="text-[11px] font-mono text-brand">{selectedElement.selector}</code>
            <button type="button" onClick={() => { setSelectedElement(null); setInspectInstruction(""); }} className="ml-auto text-text-muted hover:text-text-secondary text-[11px]">Clear</button>
          </div>
          <div className="flex gap-2">
            <input value={inspectInstruction} onChange={(e) => setInspectInstruction(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSendInspection(); }} placeholder="Make this rounded and blue..." className="flex-1 rounded bg-surface-2 px-2 py-1 text-[11px] text-text-primary outline-none border border-border focus:border-brand" />
            <Button size="sm" onClick={handleSendInspection} disabled={!inspectInstruction.trim()}><Send className="h-3 w-3" /></Button>
          </div>
        </div>
      )}

      {/* Console logs panel */}
      {showConsole && isActive && (
        <div className="border-b border-border shrink-0 max-h-32 overflow-auto bg-surface-1">
          <div className="flex items-center gap-2 px-2 py-1 border-b border-border">
            <Terminal className="h-3 w-3 text-text-muted" />
            <span className="text-[11px] uppercase text-text-muted font-semibold">Console</span>
            <span className="text-[11px] text-text-muted ml-auto">{consoleLogs.length} entries</span>
            <button type="button" onClick={() => setConsoleLogs([])} className="text-[11px] text-text-muted hover:text-text-secondary">Clear</button>
          </div>
          <div className="p-2 space-y-0.5">
            {consoleLogs.length === 0 ? (
              <p className="text-[11px] text-text-muted">No console output yet</p>
            ) : (
              consoleLogs.map((log, i) => (
                <div key={i} className={cn("text-[11px] font-mono", log.includes("error:") ? "text-danger" : log.includes("warn:") ? "text-warning" : "text-text-secondary")}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Preview frame */}
      <div className="flex-1 overflow-hidden bg-white">
        {!projectId ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Globe className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-[11px]">Select a project to preview</p>
          </div>
        ) : isActive && preview.data?.url ? (
          <div className="flex flex-col h-full">
            {/* URL bar */}
            <div className="flex items-center gap-2 px-2 py-1 bg-surface-1 border-b border-border shrink-0">
              <div className="flex items-center gap-1.5 flex-1 rounded bg-surface-2 px-2 py-0.5">
                <div className={cn("h-1.5 w-1.5 rounded-full", health.data?.reachable ? "bg-success" : "bg-danger")} />
                <span className="text-[11px] font-mono text-text-muted truncate">{preview.data.url}</span>
              </div>
              {health.data?.responseTime && (
                <span className="text-[11px] text-text-muted flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {health.data.responseTime}ms
                </span>
              )}
            </div>

            {/* Remote preview hint */}
            {isRemotePreview && (
              <div className="px-2 py-1.5 bg-warning/10 border-b border-warning/20 flex items-center gap-1.5 text-[11px] text-warning shrink-0">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>
                  {proxyTicket.data
                    ? <>Serving <code className="font-mono">{preview.data.url}</code> through the Local Bridge proxy (this browser cannot reach localhost on the bridge host directly).</>
                    : "Connecting through the Local Bridge proxy…"}
                </span>
              </div>
            )}

            {/* iframe */}
            <div className="flex justify-center flex-1 overflow-auto">
              <div style={{ width: VIEWPORT_WIDTHS[viewport], maxWidth: "100%" }} className="h-full transition-all duration-300">
                <iframe ref={iframeRef} key={iframeKey} src={iframeSrc} className="w-full h-full border-0" title="Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
              </div>
            </div>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-full text-danger">
            <AlertCircle className="h-6 w-6 mb-2" />
            <p className="text-[11px]">Preview failed to start</p>
            <p className="text-[11px] text-text-muted mt-1 max-w-xs text-center">{preview.data?.logs?.slice(-200) ?? "Unknown error"}</p>
            {crashCount > 0 && <p className="text-[11px] text-warning mt-1">Crashed {crashCount} time(s). Auto-restarting...</p>}
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" onClick={() => void restartPreview()}><RotateCcw className="h-3 w-3 mr-1" />Retry</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSetup(true)}>Reconfigure</Button>
            </div>
          </div>
        ) : isStarting ? (
          <div className="flex flex-col items-center justify-center h-full text-brand">
            <Loader2 className="h-8 w-8 mb-2 animate-spin" />
            <p className="text-[11px]">Starting preview server...</p>
            <p className="text-[11px] text-text-muted mt-1">{command}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Globe className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-[11px]">No preview running</p>
            {detection.data?.detected && <p className="text-[11px] text-text-muted mt-1">Detected: {detection.data.framework} on port {detection.data.port}</p>}
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => setShowSetup(true)}><Play className="h-3 w-3 mr-1" />Start Preview</Button>
          </div>
        )}
      </div>
    </div>
  );
}
