/**
 * Domain Verification Routes.
 * Verify organization domains for SSO auto-provisioning and email matching.
 */
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { errors } from "@ai-harness/shared";
import pino from "pino";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

const log = pino({ name: "organizations-domains", level: "warn" });

export default function registerDomainVerificationRoutes(app: FastifyInstance) {
  /**
   * List verified domains for organization.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/domains", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["domains"],
      summary: "List verified domains for organization",
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

    const domains = await app.prisma.organizationDomain.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        domain: true,
        status: true,
        verificationToken: true,
        verifiedAt: true,
        createdAt: true,
      },
    });

    return ok(reply, domains);
  });

  /**
   * Add domain for verification.
   */
  app.post<{
    Params: { orgId: string };
    Body: { domain: string };
  }>("/v1/organizations/:orgId/domains", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["domains"],
      summary: "Add domain for verification",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", format: "hostname" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const { domain } = req.body as { domain: string };

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership || membership.role !== "OWNER") throw errors.forbidden();

    // Normalize domain
    const normalizedDomain = domain.toLowerCase().trim();

    // Check for existing domain
    const existing = await app.prisma.organizationDomain.findFirst({
      where: { organizationId: orgId, domain: normalizedDomain },
    });

    if (existing) {
      throw errors.conflict("Domain already registered for this organization");
    }

    // Generate verification token
    const verificationToken = randomBytes(32).toString("hex");

    // Insert domain record
    await app.prisma.organizationDomain.create({
      data: {
        organizationId: orgId,
        domain: normalizedDomain,
        status: "PENDING",
        verificationToken,
      },
    });

    await auditFromRequest(app.prisma, req, "ORG_CREATED", "ORGANIZATION", orgId, undefined, {
      action: "DOMAIN_ADDED",
      domain: normalizedDomain,
    });

    return ok(reply, {
      domain: normalizedDomain,
      status: "PENDING",
      verificationToken,
      dnsRecord: {
        type: "TXT",
        name: `_ai-harness-verification.${normalizedDomain}`,
        value: `ai-harness-verify=${verificationToken}`,
      },
      instructions: [
        `Add a TXT record: _ai-harness-verification.${normalizedDomain}`,
        `Value: ai-harness-verify=${verificationToken}`,
        "Wait for DNS propagation (may take up to 24 hours)",
        "Then call the verify endpoint to complete verification",
      ],
    }, 201);
  });

  /**
   * Verify a domain.
   */
  app.post<{
    Params: { orgId: string; domainId: string };
  }>("/v1/organizations/:orgId/domains/:domainId/verify", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["domains"],
      summary: "Verify domain ownership",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const domainId = (req.params as { domainId: string }).domainId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership || membership.role !== "OWNER") throw errors.forbidden();

    const domainRecord = await app.prisma.organizationDomain.findFirst({
      where: { id: domainId, organizationId: orgId },
    });

    if (!domainRecord) throw errors.notFound("Domain");

    if (domainRecord.status === "VERIFIED") {
      return ok(reply, { status: "VERIFIED", domain: domainRecord.domain });
    }

    // Attempt DNS verification
    const verified = await verifyDNSRecord(domainRecord.domain, domainRecord.verificationToken);

    if (verified) {
      await app.prisma.organizationDomain.update({
        where: { id: domainId },
        data: { status: "VERIFIED", verifiedAt: new Date() },
      });

      await auditFromRequest(app.prisma, req, "ORG_CREATED", "ORGANIZATION", orgId, undefined, {
        action: "DOMAIN_VERIFIED",
        domain: domainRecord.domain,
      });

      return ok(reply, { status: "VERIFIED", domain: domainRecord.domain });
    }

    return ok(reply, {
      status: "PENDING",
      domain: domainRecord.domain,
      message: "DNS record not found. Please add the TXT record and try again.",
    });
  });

  /**
   * Delete a domain.
   */
  app.delete<{
    Params: { orgId: string; domainId: string };
  }>("/v1/organizations/:orgId/domains/:domainId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["domains"],
      summary: "Delete a domain",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const domainId = (req.params as { domainId: string }).domainId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership || membership.role !== "OWNER") throw errors.forbidden();

    const deleted = await app.prisma.organizationDomain.deleteMany({
      where: { id: domainId, organizationId: orgId },
    });

    if (deleted.count === 0) throw errors.notFound("Domain");

    await auditFromRequest(app.prisma, req, "ORG_CREATED", "ORGANIZATION", orgId, undefined, {
      action: "DOMAIN_DELETED",
      domainId,
    });

    return ok(reply, { success: true });
  });
}

async function verifyDNSRecord(domain: string, token: string): Promise<boolean> {
  try {
    const { resolveTxt } = await import("node:dns").then((m) => m.promises);
    const records = await resolveTxt(`_ai-harness-verification.${domain}`);
    const expected = `ai-harness-verify=${token}`;
    return records.some((record) => record.join("") === expected);
  } catch (err) {
    log.error({ err }, "[Domains] DNS verification failed:");
    return false;
  }
}
