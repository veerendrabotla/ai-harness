"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Copy,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface TwoFactorStatus {
  enabled: boolean;
}

interface TwoFactorSetup {
  secret: string;
  uri: string;
  backupCodes: string[];
}

export default function SecurityPage() {
  const [setupData, setSetupData] = useState<TwoFactorSetup | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const status = useQuery({
    queryKey: ["2fa-status"],
    queryFn: () => apiFetch<TwoFactorStatus>("/v1/auth/2fa/status"),
  });

  const setupMutation = useMutation({
    mutationFn: () => apiFetch<TwoFactorSetup>("/v1/auth/2fa/setup", { method: "POST" }),
    onSuccess: (data) => {
      setSetupData(data);
      setMessage(null);
    },
    onError: () => {
      setMessage({ type: "error", text: "Failed to initiate 2FA setup" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (code: string) =>
      apiFetch<{ success: boolean }>("/v1/auth/2fa/confirm", {
        method: "POST",
        json: { code, secret: setupData?.secret },
      }),
    onSuccess: () => {
      setMessage({ type: "success", text: "2FA has been enabled successfully!" });
      setSetupData(null);
      setVerifyCode("");
      void status.refetch();
    },
    onError: () => {
      setMessage({ type: "error", text: "Invalid verification code. Please try again." });
    },
  });

  const disableMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean }>("/v1/auth/2fa/disable", {
        method: "POST",
        json: { code: verifyCode },
      }),
    onSuccess: () => {
      setMessage({ type: "success", text: "2FA has been disabled." });
      setVerifyCode("");
      void status.refetch();
    },
    onError: () => {
      setMessage({ type: "error", text: "Invalid code. Could not disable 2FA." });
    },
  });

  const is2FAEnabled = status.data?.enabled ?? false;

  const copyToClipboard = async (text: string, type: "secret" | "backup") => {
    await navigator.clipboard.writeText(text);
    if (type === "secret") {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setCopiedBackup(true);
      setTimeout(() => setCopiedBackup(false), 2000);
    }
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Security</h1>
            <p className="mt-1 text-[12px] text-text-muted">Manage account security settings</p>
          </div>
        </div>

        {message && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg px-4 py-3 text-[12px] ${
              message.type === "success"
                ? "bg-success/10 text-success border border-success/20"
                : "bg-danger/10 text-danger border border-danger/20"
            }`}
          >
            {message.type === "success" ? (
              <ShieldCheck className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}

        <div className="mt-6 space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-[14px] text-text-primary">
                  Two-Factor Authentication (2FA)
                </CardTitle>
                <p className="mt-1 text-[12px] text-text-muted">
                  Add an extra layer of security with TOTP-based 2FA
                </p>
              </div>
              {status.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <span
                  className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    is2FAEnabled
                      ? "bg-success/15 text-success"
                      : "bg-surface-3 text-text-muted"
                  }`}
                >
                  {is2FAEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>

            {status.isLoading && <Skeleton className="mt-4 h-24" />}

            {status.data && !is2FAEnabled && !setupData && (
              <div className="mt-4">
                <Button
                  onClick={() => setupMutation.mutate()}
                  disabled={setupMutation.isPending}
                  className="gap-1.5"
                >
                  {setupMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Shield className="h-3.5 w-3.5" />
                  )}
                  Enable 2FA
                </Button>
              </div>
            )}

            {setupData && (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg bg-surface-2 border border-border p-4">
                  <p className="text-[12px] font-medium text-text-primary mb-2">
                    1. Scan this QR code with your authenticator app
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-white p-2">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(setupData.uri)}`}
                        alt="2FA QR Code"
                        className="h-[120px] w-[120px]"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-[11px] text-text-muted mb-1">
                        Or enter this secret manually:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-surface-3 px-2 py-1 text-[12px] font-mono text-text-primary break-all">
                          {setupData.secret}
                        </code>
                        <button
                          onClick={() => copyToClipboard(setupData.secret, "secret")}
                          className="shrink-0 rounded p-1.5 hover:bg-surface-3 transition-colors"
                        >
                          {copiedSecret ? (
                            <Check className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 text-text-muted" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-surface-2 border border-border p-4">
                  <p className="text-[12px] font-medium text-text-primary mb-2">
                    2. Save these backup codes (one-time use)
                  </p>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-2 gap-1 rounded bg-surface-3 p-2 font-mono text-[11px] text-text-primary">
                      {setupData.backupCodes.map((code, i) => (
                        <div key={i} className="px-1">
                          {code}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => copyToClipboard(setupData.backupCodes.join("\n"), "backup")}
                      className="shrink-0 rounded p-1.5 hover:bg-surface-3 transition-colors"
                    >
                      {copiedBackup ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-text-muted" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg bg-surface-2 border border-border p-4">
                  <p className="text-[12px] font-medium text-text-primary mb-2">
                    3. Enter verification code
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      className="w-32 px-3 py-2 text-[14px] font-mono bg-surface-3 border border-border rounded-lg text-center focus:outline-none focus:border-brand"
                    />
                    <Button
                      onClick={() => confirmMutation.mutate(verifyCode)}
                      disabled={verifyCode.length !== 6 || confirmMutation.isPending}
                      className="gap-1.5"
                    >
                      {confirmMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      Verify & Enable
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {status.data && is2FAEnabled && (
              <div className="mt-4">
                <p className="text-[12px] text-text-muted mb-3">
                  To disable 2FA, enter your current verification code:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    className="w-32 px-3 py-2 text-[14px] font-mono bg-surface-3 border border-border rounded-lg text-center focus:outline-none focus:border-brand"
                  />
                  <Button
                    onClick={() => disableMutation.mutate()}
                    disabled={verifyCode.length !== 6 || disableMutation.isPending}
                    variant="danger"
                    className="gap-1.5"
                  >
                    {disableMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldOff className="h-3.5 w-3.5" />
                    )}
                    Disable 2FA
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
