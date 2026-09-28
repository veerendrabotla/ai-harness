/** Cross-service queue/topic names. */

export const TASK_QUEUE = "task-lifecycle";

export type TaskJob =
  | { kind: "start"; taskId: string }
  | { kind: "resume-approved-plan"; taskId: string; userId: string; planId: string }
  | { kind: "continue-after-tool-decision"; taskId: string; approvalId: string }
  | { kind: "revise-plan"; taskId: string; userId: string; instruction: string; requestId: string };

export const TASK_EVENTS_CHANNEL = "ai-harness:task-events";

export const APPROVAL_EVENTS_CHANNEL = "ai-harness:approval-events";

/** Deployment status transitions (any process) → WS fan-out + notifications. */
export const DEPLOYMENT_STATUS_CHANNEL = "ai-harness:deployment-status";

export const EMAIL_QUEUE = "email-delivery";

export type EmailJob =
  | {
      kind: "send";
      emailId: string;
      recipientEmail: string;
      subject: string;
      html: string;
      text: string;
      templateType: string;
      workspaceId?: string;
      metadata?: Record<string, unknown>;
    };
