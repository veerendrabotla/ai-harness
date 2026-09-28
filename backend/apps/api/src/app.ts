import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import { randomUUID } from "node:crypto";
import { frontendOrigins, getEnv, redactValue } from "@ai-harness/shared";
import type { PrismaClient } from "@prisma/client";
import { prisma as db } from "@ai-harness/database";

import authPlugin from "./plugins/auth.js";
import errorHandling from "./plugins/error-handler.js";
import rateLimitPlugin from "./plugins/rate-limit.js";
import responseHeaders from "./plugins/response-headers.js";
import csrfPlugin, { registerCsrfOrigins } from "./plugins/csrf.js";
import { setupSwagger } from "./lib/swagger.js";
import socketPlugin from "./plugins/socket.js";

import registerAuthRoutes from "./modules/auth/auth.routes.js";
import registerGithubAuthRoutes from "./modules/auth/auth.github.js";
import registerGoogleAuthRoutes from "./modules/auth/auth.google.js";
import registerWorkspaceRoutes from "./modules/workspaces/workspaces.routes.js";
import registerProjectRoutes from "./modules/projects/projects.routes.js";
import registerInstructionPolicyRoutes from "./modules/instructions-policy/instructions-policy.routes.js";
import registerProviderRoutes from "./modules/providers/providers.routes.js";
import registerProviderHealthRoutes from "./modules/providers/provider-health.routes.js";
import registerTaskRoutes from "./modules/tasks/tasks.routes.js";
import registerTaskExportRoutes from "./modules/tasks/tasks.export.routes.js";
import registerPlanRoutes from "./modules/plans/plans.routes.js";
import registerActivityRoutes from "./modules/activity/activity.routes.js";
import { registerProjectInspectRoutes } from "./modules/projects/projects.inspect.js";
import registerUserRoutes from "./modules/users/users.routes.js";
import registerInviteRoutes from "./modules/invites/invites.routes.js";
import registerApprovalRoutes from "./modules/approvals/approvals.routes.js";
import registerBridgeRoutes from "./modules/bridges/bridges.routes.js";
import registerMcpRoutes from "./modules/mcp/mcp.routes.js";
import { registerFileRoutes } from "./modules/projects/projects.files.js";
import { registerFileUploadRoutes } from "./modules/projects/projects.file-uploads.js";
import { registerFileVersionRoutes } from "./modules/projects/projects.file-versions.js";
import { registerTerminalRoutes } from "./modules/projects/projects.terminal.js";
import { registerPreviewRoutes } from "./modules/projects/projects.preview.js";
import { registerSessionRoutes } from "./modules/tasks/tasks.sessions.js";
import { registerSessionPortabilityRoutes } from "./modules/tasks/tasks.portability.js";
import { registerBuilderRoutes } from "./modules/builder/builder.routes.js";
import { registerDeployRoutes } from "./modules/deploy/deploy.routes.js";
import { registerSandboxRoutes } from "./modules/sandbox/sandbox.routes.js";
import { deploymentSecretRoutes } from "./modules/deployment/deployment-secrets.routes.js";
import { deploymentProviderRoutes } from "./modules/deployment/deployment-provider.routes.js";
import registerUsageRoutes from "./modules/usage/usage.routes.js";
import registerAdminRoutes from "./modules/admin/admin.routes.js";
import registerAuditLogRoutes from "./modules/admin/audit-log.routes.js";
import registerTwoFactorRoutes from "./modules/auth/two-factor.routes.js";
import registerOrganizationRoutes from "./modules/organizations/organizations.routes.js";
import registerOrganizationSettingsRoutes from "./modules/organizations/organizations.settings.js";
import registerRolesPermissionsRoutes from "./modules/organizations/organizations.roles.js";
import registerDomainVerificationRoutes from "./modules/organizations/organizations.domains.js";
import registerIpAllowlistRoutes from "./modules/workspaces/workspaces.ip-allowlist.js";
import registerNotificationRoutes from "./modules/notifications/notifications.routes.js";
import registerInboxRoutes from "./modules/notifications/notifications.inbox.routes.js";
import registerWebhookRoutes from "./modules/notifications/webhooks.routes.js";
import registerInvitationRoutes from "./modules/invitations/invitations.routes.js";
import registerApiKeyRoutes from "./modules/api-keys/api-keys.routes.js";
import registerTaskDiffRoutes from "./modules/tasks/tasks.diff.js";
import registerEnvVarRoutes from "./modules/projects/projects.env-vars.js";
import registerFeatureFlagRoutes from "./modules/workspaces/workspaces.feature-flags.js";
import registerAdminBulkRoutes from "./modules/admin/admin-bulk.routes.js";
import registerMonitoringRoutes from "./modules/admin/monitoring.routes.js";
import registerSecurityScanRoutes from "./modules/admin/security-scan.routes.js";
import registerAuditRetentionRoutes from "./modules/workspaces/workspaces.audit-retention.js";
import registerProjectCloneRoutes from "./modules/projects/projects.clone.js";
import registerTaskTemplateRoutes from "./modules/tasks/tasks.templates.js";
import registerDeploymentCommentRoutes from "./modules/deploy/deploy.comments.js";
import registerCostAlertRoutes from "./modules/workspaces/workspaces.cost-alerts.js";
import registerTaskBranchRoutes from "./modules/tasks/tasks.branches.js";
import registerProjectPermissionRoutes from "./modules/projects/projects.permissions.js";
import registerSsoRoutes from "./modules/auth/sso.routes.js";
import registerRateLimitRoutes from "./modules/workspaces/workspaces.rate-limits.js";
import registerBackupRoutes from "./modules/workspaces/workspaces.backup.routes.js";
import { registerWebContainerRoutes } from "./modules/webcontainer/webcontainer.routes.js";
import registerWebContainerSettingsRoutes from "./modules/webcontainer/webcontainer-settings.routes.js";
import registerModelProvidersRoutes from "./modules/models/models.providers.routes.js";
import registerKnowledgeRoutes from "./modules/knowledge/knowledge.routes.js";
import registerPlaygroundRoutes from "./modules/playground/playground.routes.js";
import registerTaskRunsRoutes from "./modules/tasks/tasks.runs.routes.js";
import { registerGitWebhookRoutes } from "./lib/git-integration.js";
import { ok } from "./lib/http.js";
import { handleSCIMRequest } from "./lib/scim.js";
import { enqueueTaskJob } from "./lib/task-queue.js";
import { registerCachePlugin } from "./lib/cache-middleware.js";
import { createAuditRepository } from "@ai-harness/database";
import { EventPublisher } from "@ai-harness/agent-runtime";
import { ipAllowlistMiddleware } from "./lib/ip-allowlist.js";
import registerMultiplayerRoutes from "./modules/multiplayer/multiplayer.routes.js";
import { initMultiplayerGateway } from "./modules/multiplayer/multiplayer.gateway.js";
import registerBillingRoutes from "./modules/billing/billing.routes.js";
import registerSearchRoutes from "./modules/search/search.routes.js";
import registerProjectMemoryRoutes from "./modules/projects/projects.memories.js";
import registerExecutionTraceRoutes from "./modules/tasks/tasks.traces.js";
import registerFileVersionQueryRoutes from "./modules/projects/projects.file-version-routes.js";
import { registerGitLabWebhookRoutes } from "./lib/gitlab-integration.js";
import { registerBitbucketWebhookRoutes } from "./lib/bitbucket-integration.js";
import { registerResendWebhookRoutes } from "./lib/resend-webhook.js";
import registerCustomRoleRoutes from "./modules/organizations/organizations.custom-roles.js";
import registerAdminEmailRoutes from "./modules/admin/admin-email.routes.js";
import registerBillingSubscriptionRoutes from "./modules/billing/billing.subscriptions.routes.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export async function buildApp() {
  const env = getEnv();

  const app = Fastify({
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    trustProxy: true,
    logger:
      env.NODE_ENV === "development"
        ? { level: env.LOG_LEVEL, transport: { target: "pino-pretty", options: { colorize: true } } }
        : { level: env.LOG_LEVEL },
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate("prisma", db);

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === "production" ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // styleSrc unsafe-inline is required for Tailwind/emotion but scoped to self only
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    } : false,
  });
  await app.register(compress, { threshold: 1024 });
  await app.register(cors, {
    origin: frontendOrigins(env),
    credentials: true,
  });
  await app.register(cookie);
  registerCsrfOrigins(frontendOrigins(env));
  await app.register(csrfPlugin);
  try {
    const multipart = (await import("@fastify/multipart")).default;
    await app.register(multipart, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    });
  } catch (err) {
    app.log.error({ err }, "Failed to load @fastify/multipart");
    if (env.NODE_ENV === "production") {
      throw err;
    }
    app.log.warn("@fastify/multipart not available, file upload endpoints will not work");
  }
  await errorHandling(app);
  await authPlugin(app);
  await rateLimitPlugin(app);
  await registerCachePlugin(app);
  await responseHeaders(app);
  await app.addHook("preHandler", ipAllowlistMiddleware);
  if (env.ENABLE_REALTIME_SOCKET) {
    await socketPlugin(app);
  }
  try {
    await setupSwagger(app);
  } catch (err) {
    app.log.error({ err }, "Failed to register Swagger documentation");
  }

  // Realtime bridge for API-side events (task queued/cancelled/approved...).
  const events = new EventPublisher(db, (taskId, event) => {
    try {
      app.publishTaskEvent(taskId, event);
    } catch (err) {
      reqScopedWarn(err);
    }
  });

  const healthHandler = async (_req: unknown, reply: FastifyReply) => {
    let dbOk = false;
    try {
      await db.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch (err) {
      app.log.error({ err: redactValue(err) }, "healthcheck db query failed");
    }
    void reply.code(dbOk ? 200 : 503);
    return { data: { status: dbOk ? "ok" : "degraded", checks: { database: dbOk ? "up" : "down" } } };
  };
  app.get("/healthz", { config: { rateLimit: false } }, healthHandler);
  app.get("/v1/health", { config: { rateLimit: false } }, healthHandler);

  registerAuthRoutes(app);
  registerGithubAuthRoutes(app);
  registerGoogleAuthRoutes(app);
  registerWorkspaceRoutes(app);
  registerProjectRoutes(app);
  registerInstructionPolicyRoutes(app);
  registerProviderRoutes(app);
  registerProviderHealthRoutes(app);
  registerTaskRoutes(app, events, enqueueTaskJob);
  registerTaskExportRoutes(app);
  registerPlanRoutes(app, events, enqueueTaskJob);
  registerActivityRoutes(app, events, createAuditRepository(db));
  registerProjectInspectRoutes(app);
  registerUserRoutes(app);
  registerInviteRoutes(app);
  registerApprovalRoutes(app, events, enqueueTaskJob);
  registerBridgeRoutes(app);
  registerMcpRoutes(app);
  registerFileRoutes(app);
  registerFileUploadRoutes(app);
  registerFileVersionRoutes(app);
  registerTerminalRoutes(app);
  registerPreviewRoutes(app);
  registerSessionRoutes(app);
  registerSessionPortabilityRoutes(app);
  registerBuilderRoutes(app);
  registerDeployRoutes(app);
  registerSandboxRoutes(app);
  await app.register(deploymentSecretRoutes);
  await app.register(deploymentProviderRoutes);
  registerUsageRoutes(app);
  registerAdminRoutes(app);
  registerAuditLogRoutes(app);
  registerTwoFactorRoutes(app);
  registerOrganizationRoutes(app);
  registerOrganizationSettingsRoutes(app);
  registerRolesPermissionsRoutes(app);
  registerDomainVerificationRoutes(app);
  registerIpAllowlistRoutes(app);
  registerNotificationRoutes(app);
  registerInboxRoutes(app);
  registerWebhookRoutes(app);
  registerInvitationRoutes(app);
  registerApiKeyRoutes(app);
  registerTaskDiffRoutes(app);
  registerEnvVarRoutes(app);
  registerFeatureFlagRoutes(app);
  registerAdminBulkRoutes(app);
  registerMonitoringRoutes(app);
  registerSecurityScanRoutes(app);
  registerAuditRetentionRoutes(app);
  registerProjectCloneRoutes(app);
  registerTaskTemplateRoutes(app);
  registerDeploymentCommentRoutes(app);
  registerCostAlertRoutes(app);
  registerTaskBranchRoutes(app);
  registerProjectPermissionRoutes(app);
  registerSsoRoutes(app);
  registerRateLimitRoutes(app);
  registerBackupRoutes(app);
  registerWebContainerRoutes(app);
  registerWebContainerSettingsRoutes(app);
  registerModelProvidersRoutes(app);
  registerKnowledgeRoutes(app);
  registerPlaygroundRoutes(app);
  registerTaskRunsRoutes(app);
  registerGitWebhookRoutes(app);
  registerMultiplayerRoutes(app);
  registerBillingRoutes(app);
  registerSearchRoutes(app);
  registerProjectMemoryRoutes(app);
  registerExecutionTraceRoutes(app);
  registerFileVersionQueryRoutes(app);
  registerGitLabWebhookRoutes(app);
  registerBitbucketWebhookRoutes(app);
  registerResendWebhookRoutes(app);
  registerCustomRoleRoutes(app);
  registerAdminEmailRoutes(app);
  registerBillingSubscriptionRoutes(app);

  // SCIM endpoint
  app.all("/v1/scim/*", {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }

      // Determine organization from query param or user's first membership
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const orgId = url.searchParams.get("orgId") ?? undefined;

      let organizationId = orgId;
      if (!organizationId) {
        const membership = await app.prisma.organizationMember.findFirst({
          where: { userId },
          select: { organizationId: true },
        });
        organizationId = membership?.organizationId;
      }

      if (!organizationId) {
        return reply.code(400).send({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail: "No organization context. Provide orgId query parameter.",
          status: "400",
        });
      }

      const result = await handleSCIMRequest(
        app.prisma,
        req.method,
        req.url.split("?")[0] ?? req.url,
        req.body as Record<string, unknown> | null,
        organizationId,
      );
      return ok(reply, result);
    } catch (err) {
      if (typeof err === "object" && err !== null && "schemas" in err) {
        return reply.code(400).send(err);
      }
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  function reqScopedWarn(err: unknown) {
    app.log.warn({ err: redactValue(err instanceof Error ? err.message : err) }, "socket publish failed");
  }

  app.addHook("onClose", async () => {
    const { closeQueue } = await import("./lib/task-queue.js");
    const { closeEmailQueue } = await import("./lib/email-queue.js");
    await closeQueue();
    await closeEmailQueue();
    await db.$disconnect();
  });

  // Initialize multiplayer WebSocket gateway alongside the API server
  initMultiplayerGateway(app.server);

  return app;
}
