"use client";

/**
 * PostHog analytics wrapper.
 * Initialized only when NEXT_PUBLIC_POSTHOG_KEY is set.
 * All methods are no-ops when PostHog is not configured.
 */

let posthogInstance: typeof import("posthog-js").default | null = null;
let initPromise: Promise<typeof import("posthog-js").default> | null = null;

async function getPosthog() {
  if (posthogInstance) return posthogInstance;
  if (initPromise) return initPromise;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;

  initPromise = import("posthog-js").then(({ default: ph }) => {
    ph.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
    });
    posthogInstance = ph;
    return ph;
  });

  return initPromise;
}

/** Identify the current user for analytics. */
export async function identifyUser(userId: string, properties?: Record<string, unknown>) {
  const ph = await getPosthog();
  if (!ph) return;
  ph.identify(userId, properties);
}

/** Reset the current user (on logout). */
export async function resetAnalytics() {
  const ph = await getPosthog();
  if (!ph) return;
  ph.reset();
}

/** Capture a custom event. */
export async function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>,
) {
  const ph = await getPosthog();
  if (!ph) return;
  ph.capture(eventName, properties);
}

/** Track a feature flag check. */
export async function isFeatureEnabled(flag: string): Promise<boolean | undefined> {
  const ph = await getPosthog();
  if (!ph) return undefined;
  return ph.isFeatureEnabled(flag);
}

// Pre-defined analytics events for key product actions
export const analytics = {
  // Onboarding
  signup: (method: string) => trackEvent("user_signed_up", { method }),
  login: (method: string) => trackEvent("user_logged_in", { method }),

  // Tasks
  taskCreated: (agentMode: string, workspaceId: string) =>
    trackEvent("task_created", { agentMode, workspaceId }),
  taskCompleted: (taskId: string, duration: number) =>
    trackEvent("task_completed", { taskId, duration_seconds: duration }),
  taskFailed: (taskId: string, failureCode?: string) =>
    trackEvent("task_failed", { taskId, failure_code: failureCode }),

  // Plans
  planApproved: (taskId: string, stepCount: number) =>
    trackEvent("plan_approved", { taskId, step_count: stepCount }),
  planRejected: (taskId: string) =>
    trackEvent("plan_rejected", { taskId }),
  planRevised: (taskId: string) =>
    trackEvent("plan_revised", { taskId }),

  // Approvals
  toolApproved: (taskId: string, toolName: string, riskLevel: string) =>
    trackEvent("tool_approved", { taskId, tool_name: toolName, risk_level: riskLevel }),
  toolDenied: (taskId: string, toolName: string) =>
    trackEvent("tool_denied", { taskId, tool_name: toolName }),

  // Builder
  promptSubmitted: (promptLength: number, templateId?: string) =>
    trackEvent("builder_prompt_submitted", { prompt_length: promptLength, template_id: templateId }),
  projectCreated: (projectId: string, frameworks: string[]) =>
    trackEvent("project_created", { project_id: projectId, frameworks }),

  // Deploy
  deploymentStarted: (provider: string) =>
    trackEvent("deployment_started", { provider }),
  deploymentCompleted: (provider: string) =>
    trackEvent("deployment_completed", { provider }),
  deploymentFailed: (provider: string, error: string) =>
    trackEvent("deployment_failed", { provider, error }),

  // Workspaces
  workspaceCreated: () => trackEvent("workspace_created"),
  memberAdded: (workspaceId: string, role: string) =>
    trackEvent("workspace_member_added", { workspace_id: workspaceId, role }),

  // Providers
  providerConnected: (providerType: string) =>
    trackEvent("provider_connected", { provider_type: providerType }),

  // Usage
  usagePageViewed: () => trackEvent("usage_page_viewed"),
} as const;
