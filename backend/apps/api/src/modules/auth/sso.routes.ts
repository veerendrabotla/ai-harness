/**
 * SSO/SAML Configuration Routes.
 * Manage SSO providers for workspace authentication.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { errors, getEnv, encryptSecret, decryptSecret } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { signAccessToken } from "../../lib/tokens.js";
import { auditFromRequest } from "../../lib/audit.js";
import { exchangeOAuthCode } from "../../lib/sso-service.js";
import { parseSamlResponse, validateSamlResponse, verifySamlSignature } from "../../lib/saml-parser.js";
import { SSO_MANAGED_MARKER } from "../../lib/auth-service.js";

const SSO_PROVIDERS = ["okta", "azure_ad", "google", "saml"];

export default function registerSsoRoutes(app: FastifyInstance) {
  /**
   * List SSO configurations for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/sso", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sso"],
      summary: "List SSO configurations",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const configs = await app.prisma.ssoConfig.findMany({
      where: { workspaceId },
      select: {
        id: true,
        provider: true,
        enabled: true,
        clientId: true,
        issuerUrl: true,
        metadataUrl: true,
        domain: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, configs);
  });

  /**
   * Create SSO configuration.
   */
  app.post<{
    Params: { workspaceId: string };
    Body: {
      provider: string;
      clientId?: string;
      clientSecret?: string;
      issuerUrl?: string;
      metadataUrl?: string;
      metadataXml?: string;
      domain?: string;
    };
  }>("/v1/workspaces/:workspaceId/sso", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sso"],
      summary: "Create SSO configuration",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["provider"],
        properties: {
          provider: { type: "string", enum: SSO_PROVIDERS },
          clientId: { type: "string" },
          clientSecret: { type: "string" },
          issuerUrl: { type: "string" },
          metadataUrl: { type: "string" },
          metadataXml: { type: "string" },
          domain: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const body = req.body as {
      provider: string;
      clientId?: string;
      clientSecret?: string;
      issuerUrl?: string;
      metadataUrl?: string;
      metadataXml?: string;
      domain?: string;
    };

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    // Check if provider already exists
    const existing = await app.prisma.ssoConfig.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: body.provider } },
    });
    if (existing) throw errors.validation("SSO provider already configured");

    const config = await app.prisma.ssoConfig.create({
      data: {
        workspaceId,
        provider: body.provider,
        enabled: true,
        clientId: body.clientId,
        clientSecret: body.clientSecret ? encryptSecret(body.clientSecret, getEnv().ENCRYPTION_KEY).toString("base64") : undefined,
        issuerUrl: body.issuerUrl,
        metadataUrl: body.metadataUrl,
        metadataXml: body.metadataXml ? encryptSecret(body.metadataXml, getEnv().ENCRYPTION_KEY).toString("base64") : undefined,
        domain: body.domain,
      },
      select: {
        id: true,
        provider: true,
        enabled: true,
        clientId: true,
        issuerUrl: true,
        metadataUrl: true,
        domain: true,
        createdAt: true,
      },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "SSO_CONFIG_CREATED",
      provider: body.provider,
    });

    return ok(reply, config, 201);
  });

  /**
   * Get a single SSO configuration by ID.
   */
  app.get<{
    Params: { workspaceId: string; configId: string };
  }>("/v1/workspaces/:workspaceId/sso/:configId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sso"],
      summary: "Get SSO configuration by ID",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const { workspaceId, configId } = req.params as { workspaceId: string; configId: string };
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const config = await app.prisma.ssoConfig.findFirst({
      where: { id: configId, workspaceId },
      select: {
        id: true,
        provider: true,
        enabled: true,
        clientId: true,
        issuerUrl: true,
        metadataUrl: true,
        domain: true,
        createdAt: true,
      },
    });
    if (!config) throw errors.notFound("SSO configuration");

    return ok(reply, config);
  });

  /**
   * Update SSO configuration.
   */
  app.put<{
    Params: { workspaceId: string; configId: string };
    Body: {
      enabled?: boolean;
      clientId?: string;
      clientSecret?: string;
      issuerUrl?: string;
      metadataUrl?: string;
      metadataXml?: string;
      domain?: string;
    };
  }>("/v1/workspaces/:workspaceId/sso/:configId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sso"],
      summary: "Update SSO configuration",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const configId = (req.params as { configId: string }).configId;
    const body = req.body as {
      enabled?: boolean;
      clientId?: string;
      clientSecret?: string;
      issuerUrl?: string;
      metadataUrl?: string;
      metadataXml?: string;
      domain?: string;
    };

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const config = await app.prisma.ssoConfig.findUnique({
      where: { id: configId, workspaceId },
    });
    if (!config) throw errors.notFound("SSO configuration");

    const updated = await app.prisma.ssoConfig.update({
      where: { id: configId },
      data: {
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.clientId !== undefined && { clientId: body.clientId }),
        ...(body.clientSecret !== undefined && { clientSecret: encryptSecret(body.clientSecret, getEnv().ENCRYPTION_KEY).toString("base64") }),
        ...(body.issuerUrl !== undefined && { issuerUrl: body.issuerUrl }),
        ...(body.metadataUrl !== undefined && { metadataUrl: body.metadataUrl }),
        ...(body.metadataXml !== undefined && { metadataXml: encryptSecret(body.metadataXml, getEnv().ENCRYPTION_KEY).toString("base64") }),
        ...(body.domain !== undefined && { domain: body.domain }),
      },
      select: {
        id: true,
        provider: true,
        enabled: true,
        clientId: true,
        issuerUrl: true,
        metadataUrl: true,
        domain: true,
        createdAt: true,
      },
    });

    return ok(reply, updated);
  });

  /**
   * Delete SSO configuration.
   */
  app.delete<{
    Params: { workspaceId: string; configId: string };
  }>("/v1/workspaces/:workspaceId/sso/:configId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sso"],
      summary: "Delete SSO configuration",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const configId = (req.params as { configId: string }).configId;

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    await app.prisma.ssoConfig.delete({
      where: { id: configId, workspaceId },
    });

    return ok(reply, { success: true });
  });

  /**
   * Initiate SSO login (returns redirect URL for OAuth/SAML).
   */
  app.get<{
    Params: { workspaceId: string; provider: string };
  }>("/v1/sso/:workspaceId/:provider/login", {
    schema: {
      tags: ["sso"],
      summary: "Initiate SSO login",
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const provider = (req.params as { provider: string }).provider;

    const config = await app.prisma.ssoConfig.findUnique({
      where: { workspaceId_provider: { workspaceId, provider }, enabled: true },
    });
    if (!config) throw errors.notFound("SSO configuration");

    const state = randomUUID();
    // Store state in a short-lived cookie for CSRF protection
    reply.setCookie("sso_state", state, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600, // 10 minutes
    });

    // Build redirect URL based on provider
    let redirectUrl = "";
    const redirectUri = `${getEnv().API_BASE_URL}/v1/sso/${workspaceId}/${provider}/callback`;
    if (config.provider === "okta" || config.provider === "azure_ad" || config.provider === "google") {
      redirectUrl = `${config.issuerUrl ?? ""}/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&state=${state}`;
    } else if (config.provider === "saml") {
      // SAML: Return metadata URL for SP-initiated flow
      redirectUrl = config.metadataUrl ?? "";
    }

    return ok(reply, { redirectUrl, state });
  });

  /**
   * SSO callback handler (OAuth code exchange or SAML assertion).
   */
  app.post<{
    Params: { workspaceId: string; provider: string };
    Body: { code?: string; samlResponse?: string; state?: string };
  }>("/v1/sso/:workspaceId/:provider/callback", {
    schema: {
      tags: ["sso"],
      summary: "SSO callback",
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const provider = (req.params as { provider: string }).provider;
    const { code, samlResponse, state } = req.body as { code?: string; samlResponse?: string; state?: string };

    // Verify state
    const cookieState = req.cookies?.sso_state;
    if (!state || !cookieState || state !== cookieState) {
      throw errors.validation("Invalid SSO state");
    }

    const config = await app.prisma.ssoConfig.findUnique({
      where: { workspaceId_provider: { workspaceId, provider }, enabled: true },
    });
    if (!config) throw errors.notFound("SSO configuration");

    let email = "";
    let name = "";

    if (code && config.clientSecret) {
      // OAuth code exchange
      const clientSecret = decryptSecret(Buffer.from(config.clientSecret, "base64"), getEnv().ENCRYPTION_KEY);
      const redirectUri = `${getEnv().API_BASE_URL}/v1/sso/${workspaceId}/${provider}/callback`;
      try {
        const userInfo = await exchangeOAuthCode(provider, code, config.clientId ?? "", clientSecret, redirectUri);
        email = userInfo.email;
        name = userInfo.name;
      } catch (err) {
        throw errors.validation(`OAuth exchange failed: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    } else if (samlResponse) {
      // SAML assertion parsing
      const validation = validateSamlResponse(samlResponse);
      if (!validation.valid) {
        throw errors.validation(`SAML validation failed: ${validation.errors.join(", ")}`);
      }

      // Verify XML signature against IDP certificate
      const idpCert = config.idpCertificate;
      if (!idpCert) {
        throw errors.validation("SAML IDP certificate not configured. Cannot verify assertion.");
      }
      let xml = samlResponse;
      if (!samlResponse.includes("<")) {
        try { xml = Buffer.from(samlResponse, "base64").toString("utf-8"); } catch { /* use as-is */ }
      }
      const sigResult = verifySamlSignature(xml, idpCert);
      if (!sigResult.verified) {
        throw errors.validation(`SAML signature verification failed: ${sigResult.error}`);
      }

      const samlUser = parseSamlResponse(samlResponse);
      email = samlUser.email;
      name = samlUser.name;
    }

    if (!email) throw errors.validation("No email from SSO provider");

    // Find or create user + ensure workspace membership in a transaction
    const user = await app.prisma.$transaction(async (tx) => {
      let existingUser = await tx.user.findUnique({ where: { email } });
      if (!existingUser) {
        existingUser = await tx.user.create({
          data: {
            email,
            passwordHash: SSO_MANAGED_MARKER,
            displayName: name || email.split("@")[0] || "SSO User",
            platformRole: "USER",
          },
        });
      }

      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      });
      if (!membership) {
        await tx.workspaceMember.create({
          data: { workspaceId, userId: existingUser.id, role: "MEMBER" },
        });
      }

      return existingUser;
    });

    // Generate session token
    const token = await signAccessToken({
      sub: user.id,
      email: user.email,
      sid: randomUUID(),
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "SSO_LOGIN",
      provider,
      email,
    });

    return ok(reply, { accessToken: token, user: { id: user.id, email: user.email, displayName: name } });
  });

  /**
   * Test SSO configuration by fetching metadata.
   */
  app.get<{
    Params: { workspaceId: string; configId: string };
  }>("/v1/workspaces/:workspaceId/sso/:configId/test", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sso"],
      summary: "Test SSO configuration",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const configId = (req.params as { configId: string }).configId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const config = await app.prisma.ssoConfig.findUnique({
      where: { id: configId, workspaceId },
    });
    if (!config) throw errors.notFound("SSO configuration");

    // Basic validation
    const issues: string[] = [];
    if (!config.clientId) issues.push("Missing client ID");
    if (!config.issuerUrl && !config.metadataUrl) issues.push("Missing issuer URL or metadata URL");
    if (!config.domain && !config.issuerUrl) issues.push("Missing domain for email matching");

    return ok(reply, {
      valid: issues.length === 0,
      issues,
      provider: config.provider,
    });
  });

  /**
   * Get SAML Service Provider metadata for workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/sso/saml/metadata", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sso"],
      summary: "Get SAML SP metadata XML",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const config = await app.prisma.ssoConfig.findFirst({
      where: { workspaceId, provider: "saml" },
    });
    if (!config) throw errors.notFound("SAML configuration");

    const entityId = `${getEnv().API_BASE_URL}/v1/sso/${workspaceId}/saml/metadata`;
    const acsUrl = `${getEnv().API_BASE_URL}/v1/sso/${workspaceId}/saml/callback`;

    const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${entityId}">
  <SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${acsUrl}"
      index="1" />
  </SPSSODescriptor>
</EntityDescriptor>`;

    reply.header("Content-Type", "application/xml");
    return reply.send(metadataXml);
  });

  /**
   * SAML callback endpoint (POST binding).
   */
  app.post<{
    Params: { workspaceId: string };
    Body: { SAMLResponse?: string; RelayState?: string };
  }>("/v1/sso/:workspaceId/saml/callback", {
    schema: {
      tags: ["sso"],
      summary: "SAML SSO callback",
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { SAMLResponse } = req.body as { SAMLResponse?: string; RelayState?: string };

    if (!SAMLResponse) throw errors.validation("Missing SAML response");

    const config = await app.prisma.ssoConfig.findFirst({
      where: { workspaceId, provider: "saml", enabled: true },
    });
    if (!config) throw errors.notFound("SAML configuration");

    const validation = validateSamlResponse(SAMLResponse);
    if (!validation.valid) {
      throw errors.validation(`SAML validation failed: ${validation.errors.join(", ")}`);
    }

    const samlUser = parseSamlResponse(SAMLResponse);
    const email = samlUser.email;
    const name = samlUser.name;

    if (!email) throw errors.validation("No email from SAML response");

    // Find or create user + ensure workspace membership in a transaction
    const user = await app.prisma.$transaction(async (tx) => {
      let existingUser = await tx.user.findUnique({ where: { email } });
      if (!existingUser) {
        existingUser = await tx.user.create({
          data: {
            email,
            passwordHash: SSO_MANAGED_MARKER,
            displayName: name || email.split("@")[0] || "SAML User",
            platformRole: "USER",
          },
        });
      }

      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      });
      if (!membership) {
        await tx.workspaceMember.create({
          data: { workspaceId, userId: existingUser.id, role: "MEMBER" },
        });
      }

      return existingUser;
    });

    const token = await signAccessToken({
      sub: user.id,
      email: user.email,
      sid: randomUUID(),
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "SSO_LOGIN",
      provider: "saml",
      email,
    });

    return ok(reply, { accessToken: token, user: { id: user.id, email: user.email, displayName: name } });
  });
}
