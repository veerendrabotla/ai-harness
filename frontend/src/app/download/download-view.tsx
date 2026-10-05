"use client";

import { useEffect, useState } from "react";
import {
  Apple,
  ArrowRight,
  Check,
  Copy,
  Download,
  Monitor,
  Puzzle,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { detectPlatform, type UserPlatform } from "@/lib/platform";

const REPO = "https://github.com/veerendrabotla/ai-harness";
const RELEASE = `${REPO}/releases/latest/download`;
const INSTALL_SH =
  "curl -fsSL https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.sh | bash";
const INSTALL_PS1 =
  "irm https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.ps1 | iex";

type PlatformCard = {
  key: UserPlatform;
  title: string;
  subtitle: string;
  icon: typeof Monitor;
  downloads: Array<{ file: string; hint: string }>;
};

const PLATFORMS: PlatformCard[] = [
  {
    key: "windows",
    title: "Windows",
    subtitle: "Windows 10 / 11",
    icon: Monitor,
    downloads: [
      { file: "AI-Harness-Setup-x64.exe", hint: "Installer — recommended, auto-updates" },
      { file: "AI-Harness-Portable-x64.exe", hint: "Portable — no install required" },
    ],
  },
  {
    key: "macos",
    title: "macOS",
    subtitle: "Apple silicon & Intel",
    icon: Apple,
    downloads: [
      { file: "AI-Harness-Setup-arm64.dmg", hint: "Apple silicon (M1–M4)" },
      { file: "AI-Harness-Setup-x64.dmg", hint: "Intel" },
    ],
  },
  {
    key: "linux",
    title: "Linux",
    subtitle: "Debian, Ubuntu & AppImage-capable distros",
    icon: Terminal,
    downloads: [
      { file: "AI-Harness-Setup-x86_64.AppImage", hint: "AppImage — chmod +x, then run" },
      { file: "AI-Harness-Setup-amd64.deb", hint: "Debian / Ubuntu package" },
    ],
  },
];

function CommandBlock({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        <button
          type="button"
          aria-label={`Copy ${label} command`}
          className="rounded p-1 text-text-muted hover:text-brand transition-colors"
          onClick={async () => {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs leading-relaxed text-text-secondary">
        {command}
      </pre>
    </div>
  );
}

export function DownloadView() {
  const [detected, setDetected] = useState<UserPlatform | null>(null);

  useEffect(() => {
    setDetected(detectPlatform(navigator.userAgent, navigator.platform));
  }, []);

  return (
    <main className="min-h-dvh">
      <div className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-brand/5 via-transparent to-brand/10" />
        <div className="relative mx-auto max-w-5xl px-6 pt-16 pb-12 text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-widest text-brand">Downloads</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-text-primary mb-4">
            Get AI Harness
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-text-secondary">
            Desktop app, one-line web stack installer, or VS Code extension —
            pick your platform below. Every release is CI-built and checksummed.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-12 space-y-8">
        {/* Platform cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {PLATFORMS.map(({ key, title, subtitle, icon: Icon, downloads }) => {
            const isDetected = detected === key;
            return (
              <div
                key={key}
                className={cn(
                  "rounded-xl border bg-surface-1 p-6 transition-colors",
                  isDetected ? "border-brand" : "border-border",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-brand" aria-hidden />
                    <div>
                      <h2 className="font-semibold text-text-primary">{title}</h2>
                      <p className="text-xs text-text-muted">{subtitle}</p>
                    </div>
                  </div>
                  {isDetected && (
                    <span className="whitespace-nowrap rounded-full bg-brand/15 px-2.5 py-0.5 text-[11px] font-medium text-brand">
                      Your device
                    </span>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {downloads.map(({ file, hint }) => (
                    <a
                      key={file}
                      href={`${RELEASE}/${file}`}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 hover:border-border-strong transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-primary">{file}</div>
                        <div className="truncate text-xs text-text-muted">{hint}</div>
                      </div>
                      <Download className="h-4 w-4 shrink-0 text-text-muted group-hover:text-brand transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Web stack one-liners */}
        <div className="rounded-xl border border-border bg-surface-1 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-semibold text-text-primary">Web stack — one line, no clone</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Boots the full platform (API, worker, gateway, frontend, database) with Docker and
                prints your local URL. Requires Docker Desktop or Docker Engine with Compose v2.
              </p>
            </div>
            <a
              href={`${REPO}/blob/main/docs/INSTALL.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
            >
              Full guide <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <CommandBlock command={INSTALL_PS1} label="Windows (PowerShell)" />
            <CommandBlock command={INSTALL_SH} label="Linux / macOS (bash)" />
          </div>
        </div>

        {/* More ways */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface-1 p-6">
            <Puzzle className="h-5 w-5 text-info" aria-hidden />
            <h2 className="mt-3 font-semibold text-text-primary">VS Code extension</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Connect VS Code to the Local Bridge Gateway and run agents from your editor.
            </p>
            <a
              href={`${RELEASE}/ai-harness-0.1.1.vsix`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-text-primary hover:border-border-strong transition-colors"
            >
              <Download className="h-4 w-4" /> Install from .vsix
            </a>
            <p className="mt-2 text-xs text-text-muted">Marketplace listing coming soon.</p>
          </div>

          <div className="rounded-xl border border-border bg-surface-1 p-6">
            <ShieldCheck className="h-5 w-5 text-success" aria-hidden />
            <h2 className="mt-3 font-semibold text-text-primary">Verify your download</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Every release ships SHA-256 checksums. Compare yours against the published list
              before installing.
            </p>
            <a
              href={`${RELEASE}/SHA256SUMS.txt`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-text-primary hover:border-border-strong transition-colors"
            >
              <Download className="h-4 w-4" /> SHA256SUMS.txt
            </a>
          </div>

          <div className="rounded-xl border border-border bg-surface-1 p-6">
            <Terminal className="h-5 w-5 text-warning" aria-hidden />
            <h2 className="mt-3 font-semibold text-text-primary">Build from source</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Clone the repository and run the full stack locally — for contributors and
              air-gapped setups.
            </p>
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-text-primary hover:border-border-strong transition-colors"
            >
              <Download className="h-4 w-4" /> View on GitHub
            </a>
          </div>
        </div>

        <p className="text-center text-xs text-text-muted pb-8">
          Builds are not code-signed yet — on macOS, right-click → Open the first time (Gatekeeper).
          Auto-update checks GitHub Releases on launch and installs on quit.
        </p>
      </div>
    </main>
  );
}
