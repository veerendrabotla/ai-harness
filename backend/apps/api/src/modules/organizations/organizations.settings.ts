/**
 * Organization Settings Routes.
 * Organization-level configuration for enterprise features.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export interface OrganizationSettings {
  ssoEnforced: boolean;
  scimEnabled: boolean;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  mfaRequired: boolean;
  sessionTimeoutMinutes: number;
  maxMembers: number;
  allowedAuthMethods: string[];
  auditLogRetentionDays: number;
  customBrandingEnabled: boolean;
  webhookNotificationsEnabled: boolean;
}

const DEFAULT_SETTINGS: OrganizationSettings = {
  ssoEnforced: false,
  scimEnabled: false,
  ipAllowlistEnabled: false,
  ipAllowlist: [],
  mfaRequired: false,
  sessionTimeoutMinutes: 480,
  maxMembers: 100,
  allowedAuthMethods: ["password", "sso", "oauth"],
  auditLogRetentionDays: 90,
  customBrandingEnabled: false,
  webhookNotificationsEnabled: false,
};

export default function registerOrganizationSettingsRoutes(app: FastifyInstance) {
  /**
   * Get organization settings.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/settings", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations", "settings"],
      summary: "Get organization settings",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) throw errors.forbidden();

    const settings = await getOrganizationSettings(app, orgId);

    return ok(reply, settings);
  });

  /**
   * Update organization settings.
   */
  app.patch<{
    Params: { orgId: string };
    Body: Partial<OrganizationSettings>;
  }>("/v1/organizations/:orgId/settings", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations", "settings"],
      summary: "Update organization settings",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          ssoEnforced: { type: "boolean" },
          scimEnabled: { type: "boolean" },
          ipAllowlistEnabled: { type: "boolean" },
          ipAllowlist: { type: "array", items: { type: "string" } },
          mfaRequired: { type: "boolean" },
          sessionTimeoutMinutes: { type: "integer", minimum: 15, maximum: 1440 },
          maxMembers: { type: "integer", minimum: 1, maximum: 10000 },
          allowedAuthMethods: { type: "array", items: { type: "string" } },
          auditLogRetentionDays: { type: "integer", minimum: 7, maximum: 365 },
          customBrandingEnabled: { type: "boolean" },
          webhookNotificationsEnabled: { type: "boolean" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const updates = req.body as Partial<OrganizationSettings>;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership || membership.role !== "OWNER") throw errors.forbidden();

    // Validate allowed auth methods
    if (updates.allowedAuthMethods) {
      const validMethods = ["password", "sso", "oauth", "saml"];
      const invalid = updates.allowedAuthMethods.filter((m) => !validMethods.includes(m));
      if (invalid.length > 0) {
        throw errors.validation(`Invalid auth methods: ${invalid.join(", ")}`);
      }
    }

    const currentSettings = await getOrganizationSettings(app, orgId);
    const merged = { ...currentSettings, ...updates };

    await setOrganizationSettings(app, orgId, merged);

    await auditFromRequest(app.prisma, req, "ORG_CREATED", "ORGANIZATION", orgId, undefined, {
      action: "SETTINGS_UPDATED",
      changes: Object.keys(updates),
    });

    return ok(reply, merged);
  });

  /**
   * Get SSO enforcement status.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/settings/sso", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations", "settings"],
      summary: "Get SSO enforcement settings",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) throw errors.forbidden();

    const settings = await getOrganizationSettings(app, orgId);

    return ok(reply, {
      ssoEnforced: settings.ssoEnforced,
      scimEnabled: settings.scimEnabled,
      allowedAuthMethods: settings.allowedAuthMethods,
    });
  });

  /**
   * Get MFA requirements.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/settings/mfa", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations", "settings"],
      summary: "Get MFA requirements",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) throw errors.forbidden();

    const settings = await getOrganizationSettings(app, orgId);

    return ok(reply, {
      mfaRequired: settings.mfaRequired,
    });
  });

  /**
   * Get session configuration.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/settings/sessions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations", "settings"],
      summary: "Get session configuration",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) throw errors.forbidden();

    const settings = await getOrganizationSettings(app, orgId);

    return ok(reply, {
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      maxMembers: settings.maxMembers,
    });
  });
}

async function getOrganizationSettings(
  app: FastifyInstance,
  orgId: string,
): Promise<OrganizationSettings> {
  try {
    const row = await app.prisma.organizationSetting.findUnique({
      where: { organizationId: orgId },
      select: { settings: true },
    });

    if (row?.settings) {
      return { ...DEFAULT_SETTINGS, ...(row.settings as Record<string, unknown>) };
    }
  } catch (err) {
    app.log.error({ err }, "[Org] Failed to read organization settings:");
  }

  return { ...DEFAULT_SETTINGS };
}

async function setOrganizationSettings(
  app: FastifyInstance,
  orgId: string,
  settings: OrganizationSettings,
): Promise<void> {
  try {
    const jsonSettings = JSON.parse(JSON.stringify(settings));
    await app.prisma.organizationSetting.upsert({
      where: { organizationId: orgId },
      update: { settings: jsonSettings },
      create: { organizationId: orgId, settings: jsonSettings },
    });
  } catch (err) {
    app.log.error({ err }, "[Org] Failed to save organization settings:");
  }
}
