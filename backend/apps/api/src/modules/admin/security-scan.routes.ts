/**
 * Security Scan Routes.
 * Trigger security scans, retrieve results, list vulnerabilities, and audit dependencies.
 */
import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import { errors } from "@ai-harness/shared";
import { SecurityScanner } from "@ai-harness/security-scanner";
import { DependencyAuditor } from "@ai-harness/dependency-auditor";

const securityScanner = new SecurityScanner({
  scanDependencies: true,
  scanSecrets: true,
  severityThreshold: "low",
});

const dependencyAuditor = new DependencyAuditor({
  includeDev: true,
  severityThreshold: "low",
});

export default function registerSecurityScanRoutes(app: FastifyInstance) {
  const adminPreHandler = [app.authenticate, app.requirePlatformAdmin];

  /**
   * Trigger a security scan (admin only).
   */
  app.post<{
    Body: { type?: "secret" | "dependency" | "full"; files?: Array<{ name: string; content: string }> };
  }>("/v1/admin/security/scan", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "security"],
      summary: "Trigger a security scan (platform admin only)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["secret", "dependency", "full"], default: "full" },
          files: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "content"],
              properties: {
                name: { type: "string" },
                content: { type: "string" },
              },
            },
            maxItems: 200,
          },
        },
      },
    },
  }, async (req, reply) => {
    const body = (req.body ?? {}) as { type?: "secret" | "dependency" | "full"; files?: Array<{ name: string; content: string }> };
    const scanType = body.type ?? "full";
    const scanId = securityScanner.startScan(scanType);

    try {
      let scanResult = undefined;
      let auditResult = undefined;

      if ((scanType === "secret" || scanType === "full") && body.files?.length) {
        scanResult = securityScanner.scanFiles(body.files);
      }

      if (scanType === "dependency" || scanType === "full") {
        // Try to read package.json from workspace
        try {
          const packageJson = await import("node:fs/promises").then((fs) =>
            fs.readFile("package.json", "utf-8")
          ).catch(() => null);

          if (packageJson) {
            auditResult = await securityScanner.auditDependencies(packageJson);
          }
        } catch (err) {
          req.log.error({ err }, "[Admin] Failed to read package.json for scan:");
        }
      }

      const report = securityScanner.generateVulnerabilityReport(
        scanResult ?? { issues: [], filesScanned: 0, duration: 0 },
        auditResult,
      );

      securityScanner.completeScan(scanId, scanResult ?? { issues: [], filesScanned: 0, duration: 0 });

      return ok(reply, {
        scanId,
        type: scanType,
        status: "completed",
        report,
      }, 201);
    } catch (err) {
      securityScanner.failScan(scanId);
      throw err;
    }
  });

  /**
   * Get scan results by ID (admin only).
   */
  app.get<{
    Params: { scanId: string };
  }>("/v1/admin/security/scan/:scanId", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "security"],
      summary: "Get security scan results by ID (platform admin only)",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const scanId = (req.params as { scanId: string }).scanId;
    const scan = securityScanner.getScanById(scanId);

    if (!scan) {
      throw errors.notFound("Scan");
    }

    return ok(reply, scan);
  });

  /**
   * List scan history (admin only).
   */
  app.get("/v1/admin/security/scans", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "security"],
      summary: "List security scan history (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { limit?: number };
    const limit = Math.min(query.limit ?? 20, 100);
    const history = securityScanner.getScanHistory(limit);

    return ok(reply, { scans: history, total: history.length });
  });

  /**
   * List vulnerabilities from all scans (admin only).
   */
  app.get("/v1/admin/security/vulnerabilities", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "security"],
      summary: "List all detected vulnerabilities (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          type: { type: "string", enum: ["vulnerability", "secret", "misconfiguration", "dependency"] },
          limit: { type: "integer", default: 50 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as {
      severity?: string;
      type?: string;
      limit?: number;
    };
    const limit = Math.min(query.limit ?? 50, 200);

    // Aggregate vulnerabilities from completed scans
    const scans = securityScanner.getScanHistory(100);
    const allIssues: Array<{
      id: string;
      scanId: string;
      type: string;
      severity: string;
      title: string;
      description: string;
      file?: string;
      line?: number;
      recommendation: string;
    }> = [];

    for (const scan of scans) {
      if (scan.status !== "completed") continue;
      const result = scan.result;
      if (!result || !("issues" in result)) continue;

      for (const issue of result.issues) {
        allIssues.push({
          id: `${scan.id}-${allIssues.length}`,
          scanId: scan.id,
          type: issue.type,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          file: issue.file,
          line: issue.line,
          recommendation: issue.recommendation,
        });
      }
    }

    let filtered = allIssues;
    if (query.severity) {
      filtered = filtered.filter((i) => i.severity === query.severity);
    }
    if (query.type) {
      filtered = filtered.filter((i) => i.type === query.type);
    }

    const limited = filtered.slice(0, limit);

    return ok(reply, {
      vulnerabilities: limited,
      total: filtered.length,
      summary: {
        critical: filtered.filter((i) => i.severity === "critical").length,
        high: filtered.filter((i) => i.severity === "high").length,
        medium: filtered.filter((i) => i.severity === "medium").length,
        low: filtered.filter((i) => i.severity === "low").length,
      },
    });
  });

  /**
   * Trigger a dependency audit (admin only).
   */
  app.post<{
    Body?: { packageJson?: string };
  }>("/v1/admin/dependency-audit", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "security"],
      summary: "Trigger a dependency audit (platform admin only)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          packageJson: { type: "string", description: "package.json content. If omitted, reads from workspace root." },
        },
      },
    },
  }, async (req, reply) => {
    const body = (req.body ?? {}) as { packageJson?: string };

    let packageJsonContent = body.packageJson;
    if (!packageJsonContent) {
      try {
        packageJsonContent = await import("node:fs/promises").then((fs) =>
          fs.readFile("package.json", "utf-8")
        );
      } catch (err) {
        req.log.error({ err }, "[Admin] Failed to read package.json for dependency audit:");
        throw errors.validation("No package.json found. Provide packageJson in the request body.");
      }
    }

    const result = await dependencyAuditor.audit(packageJsonContent!);
    const riskLevel = dependencyAuditor.getRiskLevel(result);

    return ok(reply, {
      riskLevel,
      ...result,
    }, 201);
  });

  /**
   * Get dependency audit results by package name pattern (admin only).
   */
  app.get("/v1/admin/dependency-audit/results", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "security"],
      summary: "List dependency audit results with filtering (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          includeDeprecated: { type: "boolean", default: false },
          includeLicenseIssues: { type: "boolean", default: true },
          limit: { type: "integer", default: 50 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as {
      includeDeprecated?: boolean;
      includeLicenseIssues?: boolean;
      limit?: number;
    };
    const limit = Math.min(query.limit ?? 50, 200);

    try {
      const packageJsonContent = await import("node:fs/promises").then((fs) =>
        fs.readFile("package.json", "utf-8")
      );
      const result = await dependencyAuditor.audit(packageJsonContent);
      const riskLevel = dependencyAuditor.getRiskLevel(result);

      let dependencies = result.dependencies;
      if (!query.includeDeprecated) {
        dependencies = dependencies.filter((d) => !d.deprecated);
      }

      return ok(reply, {
        riskLevel,
        dependencies: dependencies.slice(0, limit),
        totalDependencies: dependencies.length,
        totalVulnerabilities: result.totalVulnerabilities,
        criticalCount: result.criticalCount,
        highCount: result.highCount,
        mediumCount: result.mediumCount,
        lowCount: result.lowCount,
        outdatedCount: result.outdatedCount,
        licenseIssues: query.includeLicenseIssues ? result.licenseIssues : [],
      });
    } catch (err) {
      req.log.error({ err }, "[Admin] Dependency audit failed:");
      throw errors.validation("Unable to read package.json for dependency audit");
    }
  });
}
