"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Coins,
  Check,
  Loader2,
  Zap,
  Building2,
  Star,
  ExternalLink,
  CreditCard,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { CostAlertsManager } from "@/components/cost-alerts-manager";
import { formatNumber } from "@/lib/utils";

interface UsageQuota {
  workspaceId: string;
  monthlyTokens: number;
  monthlyCost: number;
  monthlyTokensLimit: number;
  monthlyCostLimit: number;
  periodStart: string;
  periodEnd: string;
}

interface BillingPlan {
  id: string;
  name: string;
  monthlyTokensLimit: number;
  monthlyCostLimit: number;
  pricePerMonth: number;
  features: string[];
}

interface Subscription {
  planId: string;
  status: "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING";
  currentPeriodEnd: string;
}

const PLANS: BillingPlan[] = [
  {
    id: "free",
    name: "Free",
    monthlyTokensLimit: 1_000_000,
    monthlyCostLimit: 10,
    pricePerMonth: 0,
    features: ["1M tokens/month", "$10 cost limit", "Basic models", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyTokensLimit: 10_000_000,
    monthlyCostLimit: 100,
    pricePerMonth: 49,
    features: ["10M tokens/month", "$100 cost limit", "All models", "Priority support", "Advanced analytics"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyTokensLimit: 100_000_000,
    monthlyCostLimit: 1000,
    pricePerMonth: 499,
    features: ["100M tokens/month", "$1,000 cost limit", "Custom models", "Dedicated support", "SLA", "SSO"],
  },
];

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Coins className="h-5 w-5" />,
  pro: <Zap className="h-5 w-5" />,
  enterprise: <Building2 className="h-5 w-5" />,
};

const PLAN_COLORS: Record<string, string> = {
  free: "text-text-muted",
  pro: "text-brand",
  enterprise: "text-warning",
};

export default function BillingPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspacesQuery.data?.[0]?.id ?? "";

  const quota = useQuery({
    queryKey: ["usage-quota", wsId],
    enabled: Boolean(wsId),
    queryFn: () => apiFetch<UsageQuota>(`/v1/usage/quota?workspaceId=${wsId}`),
  });

  const plansQuery = useQuery({
    queryKey: ["billing-plans"],
    queryFn: () => apiFetch<BillingPlan[]>("/v1/billing/plans"),
  });

  const subscriptionQuery = useQuery({
    queryKey: ["billing-subscription", wsId],
    queryFn: () => apiFetch<Subscription>(`/v1/billing/subscription?workspaceId=${wsId}`),
    enabled: Boolean(wsId),
  });

  const plans = plansQuery.data ?? PLANS;
  const subscription = subscriptionQuery.data;

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiFetch<{ url: string }>("/v1/billing/checkout", {
        method: "POST",
        json: { planId, workspaceId: wsId },
      });
      return res;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => setCheckoutError(err instanceof Error ? err.message : "Checkout failed"),
  });

  const portalMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>("/v1/billing/portal", {
        method: "POST",
        json: { workspaceId: wsId },
      }),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => setCheckoutError(err instanceof Error ? err.message : "Failed to open billing portal"),
  });

  const tokenUsagePercent = quota.data
    ? Math.min(100, (quota.data.monthlyTokens / quota.data.monthlyTokensLimit) * 100)
    : 0;

  const costUsagePercent = quota.data
    ? Math.min(100, (quota.data.monthlyCost / quota.data.monthlyCostLimit) * 100)
    : 0;

  const getUsageColor = (percent: number) => {
    if (percent >= 90) return "bg-danger";
    if (percent >= 70) return "bg-warning";
    return "bg-brand";
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        <div className="flex items-center gap-3">
          <Coins className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Billing & Usage</h1>
            <p className="mt-1 text-[12px] text-text-muted">Monitor usage and manage your plan</p>
          </div>
        </div>

        {quota.isError && (
          <div className="mt-4">
            <ErrorState error="Failed to load usage data" onRetry={() => quota.refetch()} />
          </div>
        )}

        {quota.isLoading && <Skeleton className="mt-6 h-48" />}

        {quota.data && (
          <Card className="mt-6 p-5">
            <CardTitle className="text-[14px] text-text-primary">Current Usage</CardTitle>
            <p className="mt-1 text-[11px] text-text-muted">
              Period: {new Date(quota.data.periodStart).toLocaleDateString()} -{" "}
              {new Date(quota.data.periodEnd).toLocaleDateString()}
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] text-text-muted">Tokens</p>
                  <p className="text-[12px] font-medium text-text-primary">
                    {formatNumber(quota.data.monthlyTokens)} / {formatNumber(quota.data.monthlyTokensLimit)}
                  </p>
                </div>
                <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${getUsageColor(tokenUsagePercent)}`}
                    style={{ width: `${tokenUsagePercent}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-text-muted">{tokenUsagePercent.toFixed(1)}% used</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] text-text-muted">Cost</p>
                  <p className="text-[12px] font-medium text-text-primary">
                    ${quota.data.monthlyCost.toFixed(2)} / ${quota.data.monthlyCostLimit}
                  </p>
                </div>
                <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${getUsageColor(costUsagePercent)}`}
                    style={{ width: `${costUsagePercent}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-text-muted">{costUsagePercent.toFixed(1)}% used</p>
              </div>
            </div>
          </Card>
        )}

        {quota.data && (
          <div className="mt-8">
            <CostAlertsManager workspaceId={quota.data.workspaceId} />
          </div>
        )}

        {subscription && (
          <Card className="mt-6 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-brand" />
                <div>
                  <CardTitle className="text-[14px] text-text-primary">Current Subscription</CardTitle>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-brand/10 text-brand">
                      {plans.find((p) => p.id === subscription.planId)?.name ?? subscription.planId}
                    </span>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${
                      subscription.status === "ACTIVE" ? "bg-success/10 text-success" :
                      subscription.status === "PAST_DUE" ? "bg-danger/10 text-danger" :
                      "bg-surface-3 text-text-muted"
                    }`}>
                      {subscription.status}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-text-muted">
                  Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-1.5"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  Manage Subscription
                </Button>
              </div>
            </div>
          </Card>
        )}

        <h2 className="mt-8 text-[16px] font-bold text-text-primary">Plans</h2>
        <p className="mt-1 text-[12px] text-text-muted">Choose the plan that fits your needs</p>

        {checkoutError && (
          <p className="mt-2 text-[12px] text-danger">{checkoutError}</p>
        )}

        {quota.isLoading ? (
          <Skeleton className="mt-4 h-48" />
        ) : (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`p-5 cursor-pointer transition-all ${
                selectedPlan === plan.id
                  ? "border-brand ring-1 ring-brand"
                  : "hover:border-border-strong"
              }`}
              onClick={() => setSelectedPlan(plan.id)}
            >
              <div className={`flex items-center gap-2 ${PLAN_COLORS[plan.id]}`}>
                {PLAN_ICONS[plan.id]}
                <CardTitle className="text-[16px]">{plan.name}</CardTitle>
              </div>

              <div className="mt-3">
                <span className="text-[28px] font-bold text-text-primary">${plan.pricePerMonth}</span>
                <span className="text-[12px] text-text-muted">/month</span>
              </div>

              <ul className="mt-4 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[12px] text-text-muted">
                    <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                    {feature}
                  </li>
                ))}
              </ul>

              {selectedPlan === plan.id && subscription?.planId === plan.id ? (
                <Button className="mt-4 w-full gap-1.5" disabled>
                  <Star className="h-3.5 w-3.5" />
                  Current Plan
                </Button>
              ) : selectedPlan === plan.id ? (
                <Button
                  className="mt-4 w-full gap-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    checkoutMutation.mutate(plan.id);
                  }}
                  disabled={checkoutMutation.isPending}
                >
                  {checkoutMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  Upgrade to {plan.name}
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
        )}
      </div>
    </AppShell>
  );
}
