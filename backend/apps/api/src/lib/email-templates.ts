/**
 * Email Templates.
 * Templates for invitation and notification emails.
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
  unsubscribeType: string;
}

function frontendBaseUrl(): string {
  const raw = process.env.FRONTEND_URL ?? process.env.FRONTEND_ORIGIN?.split(",")[0]?.trim();
  return raw || "http://localhost:3000";
}

function baseHtml(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px 0; border-bottom: 1px solid #e5e5e5; }
    .logo { font-size: 24px; font-weight: bold; color: #6366f1; }
    .content { padding: 30px 0; }
    .button { display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; }
    .button:hover { background: #4f46e5; }
    .footer { padding: 30px 0; border-top: 1px solid #e5e5e5; color: #666; font-size: 14px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 500; }
    .status-completed { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .status-ready { background: #dbeafe; color: #1e40af; }
    .status-review { background: #fef3c7; color: #92400e; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px; margin-top: 16px; color: #991b1b; font-size: 14px; }
    .info-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px; margin-top: 16px; color: #1e40af; font-size: 14px; }
    .role-badge { display: inline-block; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #374151; }
    .unsubscribe { margin-top: 24px; font-size: 12px; color: #999; }
    .unsubscribe a { color: #999; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">AI Harness</div>
  </div>
  <div class="content">
    ${content}
  </div>
  <div class="footer">
    <p>AI Harness - AI-powered software development platform</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate invitation email template.
 */
export function invitationEmail(
  inviterName: string,
  workspaceName: string,
  inviteUrl: string,
  role: string,
  unsubscribeUrl?: string,
): EmailTemplate {
  const subject = `${inviterName} invited you to join ${workspaceName} on AI Harness`;

  const content = `
    <h2>You've been invited!</h2>
    <p><strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on AI Harness.</p>
    <p>Your role: <span class="role-badge">${role}</span></p>
    <p style="margin-top: 24px;">
      <a href="${inviteUrl}" class="button">Accept Invitation</a>
    </p>
    <p style="margin-top: 24px; color: #666; font-size: 14px;">
      This invitation expires in 7 days.
    </p>
    <p style="color: #666; font-size: 14px;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from invitations</a></div>` : ""}
  `;

  const text = `
You've been invited!

${inviterName} has invited you to join ${workspaceName} on AI Harness.
Your role: ${role}

Accept the invitation here: ${inviteUrl}

This invitation expires in 7 days.

If you didn't expect this invitation, you can safely ignore this email.
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "invitation" };
}

/**
 * Generate task completion email template.
 */
export function taskCompletionEmail(
  taskGoal: string,
  taskId: string,
  status: "completed" | "failed",
  error?: string,
  unsubscribeUrl?: string,
  baseUrl: string = frontendBaseUrl(),
): EmailTemplate {
  const subject = status === "completed"
    ? `Task completed: ${taskGoal.slice(0, 50)}`
    : `Task failed: ${taskGoal.slice(0, 50)}`;

  const content = `
    <h2>Task ${status === "completed" ? "Completed" : "Failed"}</h2>
    <p><span class="status-badge status-${status}">${status === "completed" ? "Completed" : "Failed"}</span></p>
    <p style="margin-top: 16px;"><strong>${taskGoal}</strong></p>
    ${error ? `<div class="error-box"><strong>Error:</strong> ${error}</div>` : ""}
    <p style="margin-top: 24px;">
      <a href="${baseUrl}/tasks/${taskId}" class="button">View Task</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from task notifications</a></div>` : ""}
  `;

  const text = `
Task ${status === "completed" ? "Completed" : "Failed"}

${taskGoal}

${error ? `Error: ${error}` : ""}

View the task here: ${baseUrl}/tasks/${taskId}
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: status === "completed" ? "task_completed" : "task_failed" };
}

/**
 * Generate deployment ready email template.
 */
export function deploymentReadyEmail(
  projectName: string,
  deploymentId: string,
  environment: string,
  url: string,
  branch: string,
  unsubscribeUrl?: string,
): EmailTemplate {
  const subject = `Deployment ready: ${projectName} (${environment})`;

  const content = `
    <h2>Deployment Ready</h2>
    <p><span class="status-badge status-ready">Ready</span></p>
    <p style="margin-top: 16px;">Your deployment of <strong>${projectName}</strong> to <strong>${environment}</strong> is live.</p>
    <div class="info-box">
      <strong>Branch:</strong> ${branch}<br>
      <strong>Environment:</strong> ${environment}
    </div>
    <p style="margin-top: 24px;">
      <a href="${url}" class="button">View Deployment</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from deployment notifications</a></div>` : ""}
  `;

  const text = `
Deployment Ready

Your deployment of ${projectName} to ${environment} is live.
Branch: ${branch}
Environment: ${environment}

View the deployment here: ${url}
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "deployment_ready" };
}

/**
 * Generate deployment failed email template.
 */
export function deploymentFailedEmail(
  projectName: string,
  deploymentId: string,
  environment: string,
  branch: string,
  error: string,
  unsubscribeUrl?: string,
  baseUrl: string = frontendBaseUrl(),
): EmailTemplate {
  const subject = `Deployment failed: ${projectName} (${environment})`;

  const content = `
    <h2>Deployment Failed</h2>
    <p><span class="status-badge status-failed">Failed</span></p>
    <p style="margin-top: 16px;">Your deployment of <strong>${projectName}</strong> to <strong>${environment}</strong> has failed.</p>
    <div class="info-box">
      <strong>Branch:</strong> ${branch}<br>
      <strong>Environment:</strong> ${environment}
    </div>
    <div class="error-box"><strong>Error:</strong> ${error}</div>
    <p style="margin-top: 24px;">
      <a href="${baseUrl}/deployments/${deploymentId}" class="button">View Deployment</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from deployment notifications</a></div>` : ""}
  `;

  const text = `
Deployment Failed

Your deployment of ${projectName} to ${environment} has failed.
Branch: ${branch}
Environment: ${environment}
Error: ${error}

View the deployment here: ${baseUrl}/deployments/${deploymentId}
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "deployment_failed" };
}

/**
 * Generate code review email template.
 */
export function codeReviewEmail(
  reviewerName: string,
  taskGoal: string,
  taskId: string,
  status: "requested" | "completed",
  comments?: string,
  unsubscribeUrl?: string,
  baseUrl: string = frontendBaseUrl(),
): EmailTemplate {
  const subject = status === "requested"
    ? `Code review requested: ${taskGoal.slice(0, 50)}`
    : `Code review completed: ${taskGoal.slice(0, 50)}`;

  const content = `
    <h2>Code Review ${status === "requested" ? "Requested" : "Completed"}</h2>
    <p><span class="status-badge status-review">${status === "requested" ? "Review Requested" : "Review Complete"}</span></p>
    <p style="margin-top: 16px;"><strong>${reviewerName}</strong> ${status === "requested" ? "requested a review on" : "completed a review of"} <strong>${taskGoal}</strong></p>
    ${comments ? `<div class="info-box"><strong>Comments:</strong><br>${comments}</div>` : ""}
    <p style="margin-top: 24px;">
      <a href="${baseUrl}/tasks/${taskId}" class="button">View Task</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from code review notifications</a></div>` : ""}
  `;

  const text = `
Code Review ${status === "requested" ? "Requested" : "Completed"}

${reviewerName} ${status === "requested" ? "requested a review on" : "completed a review of"} ${taskGoal}
${comments ? `\nComments: ${comments}` : ""}

View the task here: ${baseUrl}/tasks/${taskId}
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "code_review" };
}

/**
 * Generate comment notification email template.
 */
export function commentEmail(
  commenterName: string,
  entityType: string,
  entityName: string,
  entityId: string,
  comment: string,
  unsubscribeUrl?: string,
  baseUrl: string = frontendBaseUrl(),
): EmailTemplate {
  const subject = `${commenterName} commented on ${entityType}: ${entityName.slice(0, 50)}`;

  const content = `
    <h2>New Comment</h2>
    <p><strong>${commenterName}</strong> commented on <strong>${entityType}</strong>: ${entityName}</p>
    <div class="info-box"><strong>Comment:</strong><br>${comment}</div>
    <p style="margin-top: 24px;">
      <a href="${baseUrl}/${entityType.toLowerCase()}s/${entityId}" class="button">View ${entityType}</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from comment notifications</a></div>` : ""}
  `;

  const text = `
New Comment

${commenterName} commented on ${entityType}: ${entityName}
Comment: ${comment}

View the ${entityType} here: ${baseUrl}/${entityType.toLowerCase()}s/${entityId}
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "comment" };
}

/**
 * Generate mention notification email template.
 */
export function mentionEmail(
  mentionerName: string,
  entityType: string,
  entityName: string,
  entityId: string,
  context: string,
  unsubscribeUrl?: string,
  baseUrl: string = frontendBaseUrl(),
): EmailTemplate {
  const subject = `${mentionerName} mentioned you in ${entityType}: ${entityName.slice(0, 50)}`;

  const content = `
    <h2>You Were Mentioned</h2>
    <p><strong>${mentionerName}</strong> mentioned you in <strong>${entityType}</strong>: ${entityName}</p>
    <div class="info-box"><strong>Context:</strong><br>${context}</div>
    <p style="margin-top: 24px;">
      <a href="${baseUrl}/${entityType.toLowerCase()}s/${entityId}" class="button">View ${entityType}</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from mention notifications</a></div>` : ""}
  `;

  const text = `
You Were Mentioned

${mentionerName} mentioned you in ${entityType}: ${entityName}

Context: ${context}

View the ${entityType} here: ${baseUrl}/${entityType.toLowerCase()}s/${entityId}
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "mention" };
}

/**
 * Generate approval request email template.
 */
export function approvalRequestEmail(
  taskGoal: string,
  taskId: string,
  requesterName: string,
  description: string,
  unsubscribeUrl?: string,
  baseUrl: string = frontendBaseUrl(),
): EmailTemplate {
  const subject = `Approval needed: ${taskGoal.slice(0, 50)}`;

  const content = `
    <h2>Approval Required</h2>
    <p><strong>${requesterName}</strong> is requesting your approval for a task.</p>
    <p style="margin-top: 16px;"><strong>${taskGoal}</strong></p>
    <div class="info-box"><strong>Description:</strong><br>${description}</div>
    <p style="margin-top: 24px;">
      <a href="${baseUrl}/tasks/${taskId}" class="button">Review & Approve</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from approval notifications</a></div>` : ""}
  `;

  const text = `
Approval Required

${requesterName} is requesting your approval for a task.
${taskGoal}

Description: ${description}

Review and approve here: ${baseUrl}/tasks/${taskId}
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "approval_request" };
}

/**
 * Generate usage warning email template.
 */
export function usageWarningEmail(
  workspaceName: string,
  currentUsage: number,
  threshold: number,
  period: string,
  unsubscribeUrl?: string,
  baseUrl: string = frontendBaseUrl(),
): EmailTemplate {
  const subject = `Usage warning: ${workspaceName} approaching limit`;

  const content = `
    <h2>Usage Warning</h2>
    <p>Your workspace <strong>${workspaceName}</strong> is approaching its usage limit.</p>
    <div class="info-box">
      <strong>Current usage:</strong> ${currentUsage.toLocaleString()} tokens<br>
      <strong>Threshold:</strong> ${threshold.toLocaleString()} tokens<br>
      <strong>Period:</strong> ${period}
    </div>
    <p style="margin-top: 24px;">
      <a href="${baseUrl}/usage" class="button">View Usage</a>
    </p>
    ${unsubscribeUrl ? `<div class="unsubscribe"><a href="${unsubscribeUrl}">Unsubscribe from usage notifications</a></div>` : ""}
  `;

  const text = `
Usage Warning

Your workspace ${workspaceName} is approaching its usage limit.

Current usage: ${currentUsage.toLocaleString()} tokens
Threshold: ${threshold.toLocaleString()} tokens
Period: ${period}

View usage here: ${baseUrl}/usage
${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}
  `.trim();

  return { subject, html: baseHtml(content), text, unsubscribeType: "usage_warning" };
}
