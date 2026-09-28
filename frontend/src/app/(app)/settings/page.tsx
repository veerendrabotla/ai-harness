"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Globe,
  Key,
  Server,
  Shield,
  Users,
  Zap,
  ArrowRight,
  HardDrive,
  User,
  CreditCard,
  Webhook,
  Bell,
  Database,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { ErrorState } from "@/components/ui/states";

interface ProviderStatus {
  id: string;
  displayName: string;
  providerType: string;
  status: string;
  hasCredential: boolean;
}

interface McpServer {
  id: string;
  name: string;
  transport: string;
  status: string;
}

interface Bridge {
  id: string;
  name: string;
  status: string;
}

const SETTINGS_SECTIONS = [
  {
    href: "/settings/providers",
    label: "Model Providers",
    description: "Connect OpenAI, Anthropic, Ollama, or custom API providers",
    icon: Key,
    color: "text-brand",
  },
  {
    href: "/settings/routing",
    label: "Stage Routing",
    description: "Route planning, implementation, and review to different models",
    icon: Zap,
    color: "text-warning",
  },
  {
    href: "/settings/mcp",
    label: "MCP Servers",
    description: "Model Context Protocol servers for extended tool capabilities",
    icon: Server,
    color: "text-info",
  },
  {
    href: "/settings/bridges",
    label: "Device Bridges",
    description: "Connect local development machines for file and git operations",
    icon: Globe,
    color: "text-success",
  },
  {
    href: "/settings/members",
    label: "Team Members",
    description: "Manage workspace members and roles",
    icon: Users,
    color: "text-state-verifying",
  },
  {
    href: "/settings/security",
    label: "Security",
    description: "Active sessions, password management, account security",
    icon: Shield,
    color: "text-danger",
  },
  {
    href: "/settings/sso",
    label: "SSO / SAML",
    description: "Single sign-on configuration for Okta, Azure AD, Google, SAML",
    icon: Shield,
    color: "text-info",
  },
  {
    href: "/settings/rate-limits",
    label: "Rate Limits",
    description: "Configure per-user API rate limits for your workspace",
    icon: Zap,
    color: "text-warning",
  },
  {
    href: "/settings/webcontainer",
    label: "WebContainer",
    description: "Run code in the browser with StackBlitz WebContainers",
    icon: HardDrive,
    color: "text-success",
  },
  {
    href: "/settings/account",
    label: "Account",
    description: "Edit your profile, email, and password",
    icon: User,
    color: "text-info",
  },
  {
    href: "/settings/billing",
    label: "Billing",
    description: "Manage your plan, usage quotas, and payment",
    icon: CreditCard,
    color: "text-warning",
  },
  {
    href: "/settings/webhooks",
    label: "Webhooks",
    description: "Manage webhook subscriptions for event notifications",
    icon: Webhook,
    color: "text-danger",
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    description: "Configure notification channels and preferences",
    icon: Bell,
    color: "text-info",
  },
  {
    href: "/settings/backups",
    label: "Backups",
    description: "Create and manage workspace backups",
    icon: Database,
    color: "text-warning",
  },
];

export default function SettingsPage() {
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiFetch<ProviderStatus[]>("/v1/providers"),
  });

  const mcpServers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => apiFetch<McpServer[]>("/v1/mcp/servers"),
  });

  const bridges = useQuery({
    queryKey: ["bridges"],
    queryFn: () => apiFetch<Bridge[]>("/v1/bridges"),
  });

  const activeProviders = (providers.data ?? []).filter((p) => p.status === "ACTIVE").length;
  const totalProviders = (providers.data ?? []).length;
  const activeMcp = (mcpServers.data ?? []).filter((s) => s.status === "ACTIVE").length;
  const connectedBridges = (bridges.data ?? []).filter((b) => b.status === "CONNECTED").length;

  const hasError = providers.isError || mcpServers.isError || bridges.isError;

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-3xl">
        <h1 className="text-h1">Settings</h1>
        <p className="mt-1 text-[12px] text-text-muted">
          Configure your AI development environment
        </p>

        {hasError && (
          <div className="mt-4">
            <ErrorState
              error="Failed to load settings data"
              onRetry={() => {
                providers.refetch();
                mcpServers.refetch();
                bridges.refetch();
              }}
            />
          </div>
        )}

        <div className="mt-6 space-y-2">
          {SETTINGS_SECTIONS.map(({ href, label, description, icon: Icon, color }) => {
            // Compute status badge
            let badge: string | null = null;
            if (href === "/settings/providers") {
              badge = totalProviders > 0 ? `${activeProviders}/${totalProviders} active` : "None configured";
            } else if (href === "/settings/mcp") {
              badge = activeMcp > 0 ? `${activeMcp} active` : "None";
            } else if (href === "/settings/bridges") {
              badge = connectedBridges > 0 ? `${connectedBridges} connected` : "None";
            }

            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-4 rounded-lg border border-border bg-surface-1 px-4 py-3.5 transition-colors hover:border-border-strong hover:bg-surface-2 group"
              >
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3", color)}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-text-primary group-hover:text-brand transition-colors">
                    {label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted leading-relaxed">
                    {description}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {badge && (
                    <span className="text-[11px] text-text-muted bg-surface-3 rounded-full px-2 py-0.5">
                      {badge}
                    </span>
                  )}
                  <ArrowRight className="h-4 w-4 text-text-muted group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
