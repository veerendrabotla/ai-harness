import type {
  SecurityIssue,
  ScanResult,
  ScanConfig,
  IssueSeverity,
  DependencyAuditEntry,
  DependencyAuditResult,
  VulnerabilityReport,
  ScanHistoryEntry,
} from "./types.js";
import { execSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class SecurityScanner {
  private config: ScanConfig;
  private scanHistory: ScanHistoryEntry[] = [];

  constructor(config?: ScanConfig) {
    this.config = {
      scanDependencies: config?.scanDependencies ?? true,
      scanSecrets: config?.scanSecrets ?? true,
      severityThreshold: config?.severityThreshold ?? "low",
    };
  }

  scanFile(content: string, filename: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    if (this.config.scanSecrets) {
      issues.push(...this.scanForSecrets(content, filename));
    }

    return issues.filter((i) => this.meetsSeverityThreshold(i.severity));
  }

  scanFiles(files: { name: string; content: string }[]): ScanResult {
    const startTime = Date.now();
    const allIssues: SecurityIssue[] = [];

    for (const file of files) {
      allIssues.push(...this.scanFile(file.content, file.name));
    }

    return {
      issues: allIssues,
      filesScanned: files.length,
      duration: Date.now() - startTime,
    };
  }

  private scanForSecrets(content: string, filename: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const lines = content.split("\n");

    const secretPatterns = [
      { pattern: /api[_-]?key\s*[:=]\s*["']([^"']+)["']/i, type: "API Key" },
      { pattern: /secret\s*[:=]\s*["']([^"']+)["']/i, type: "Secret" },
      { pattern: /password\s*[:=]\s*["']([^"']+)["']/i, type: "Password" },
      { pattern: /token\s*[:=]\s*["']([^"']+)["']/i, type: "Token" },
      { pattern: /AKIA[0-9A-Z]{16}/, type: "AWS Access Key" },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || "";

      for (const { pattern, type } of secretPatterns) {
        if (pattern.test(line)) {
          issues.push({
            type: "secret",
            severity: "critical",
            title: `${type} detected`,
            description: `Found potential ${type.toLowerCase()} in code`,
            file: filename,
            line: i + 1,
            recommendation: "Move secrets to environment variables or a secrets manager",
          });
        }
      }
    }

    return issues;
  }

  private meetsSeverityThreshold(severity: IssueSeverity): boolean {
    const levels: IssueSeverity[] = ["critical", "high", "medium", "low"];
    const thresholdIndex = levels.indexOf(this.config.severityThreshold!);
    const severityIndex = levels.indexOf(severity);
    return severityIndex <= thresholdIndex;
  }

  async auditDependencies(packageJsonContent: string): Promise<DependencyAuditResult> {
    const startTime = Date.now();
    const dependencies: DependencyAuditEntry[] = [];

    try {
      const pkg = JSON.parse(packageJsonContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Try to use npm audit for real vulnerability data
      try {
        const tempDir = await mkdtemp(join(tmpdir(), "audit-"));
        const tempPkg = join(tempDir, "package.json");
        await writeFile(tempPkg, JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }));
        
        try {
          const auditResult = execSync("npm audit --json", { cwd: tempDir, encoding: "utf8", timeout: 30_000 });
          const audit = JSON.parse(auditResult) as { vulnerabilities?: Record<string, { severity: string; via: Array<{ title?: string; url?: string }>; fixAvailable?: boolean | { name: string } }> };
          
          if (audit.vulnerabilities) {
            for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
              const severity = vuln.severity as IssueSeverity;
              if (this.meetsSeverityThreshold(severity)) {
                const via = vuln.via.find((v) => typeof v === "object" && v.title) as { title?: string } | undefined;
                dependencies.push({
                  name,
                  version: allDeps[name] ?? "unknown",
                  severity,
                  title: via?.title ?? `Vulnerability in ${name}`,
                  description: `npm audit detected ${severity} severity vulnerability`,
                  recommendation: `Run npm audit fix or update ${name}`,
                  fixAvailable: Boolean(vuln.fixAvailable),
                });
              }
            }
          }
        } finally {
          await rm(tempDir, { recursive: true, force: true }).catch((err) => { console.warn("[SecurityScanner] Failed to clean temp dir:", err); });
        }
      } catch (err) {
        console.error("[Security] npm audit unavailable, using fallback patterns:", err);
        const knownVulnerabilities: Record<string, { severity: IssueSeverity; title: string; description: string; fixAvailable: boolean }> = {
          "lodash": { severity: "high", title: "Prototype Pollution in lodash", description: "Versions < 4.17.21 are vulnerable to prototype pollution", fixAvailable: true },
          "minimist": { severity: "high", title: "Prototype Pollution in minimist", description: "Versions < 1.2.6 are vulnerable to prototype pollution", fixAvailable: true },
          "node-fetch": { severity: "medium", title: "Exposure of Sensitive Information in node-fetch", description: "Versions < 2.6.7 may expose sensitive information", fixAvailable: true },
          "glob-parent": { severity: "high", title: "ReDoS in glob-parent", description: "Versions < 5.1.2 are vulnerable to regular expression DoS", fixAvailable: true },
          "ansi-regex": { severity: "high", title: "ReDoS in ansi-regex", description: "Versions < 5.0.1 are vulnerable to regular expression DoS", fixAvailable: true },
        };

        for (const [name, versionSpec] of Object.entries(allDeps)) {
          if (!name || !versionSpec) continue;
          const vuln = knownVulnerabilities[name];
          if (vuln && this.meetsSeverityThreshold(vuln.severity)) {
            dependencies.push({
              name,
              version: versionSpec,
              severity: vuln.severity,
              title: vuln.title,
              description: vuln.description,
              recommendation: `Update ${name} to the latest patched version`,
              fixAvailable: vuln.fixAvailable,
            });
          }
        }
      }
    } catch (err) {
      console.error("[Security] Dependency audit parse error:", err);
      dependencies.push({
        name: "parse-error",
        version: "unknown",
        severity: "medium",
        title: "Failed to parse package.json",
        description: "Could not parse package.json for dependency audit",
        recommendation: "Ensure package.json is valid JSON",
        fixAvailable: false,
      });
    }

    return {
      dependencies,
      totalChecked: dependencies.length > 0 ? dependencies.length : 0,
      vulnerabilities: dependencies.length,
      duration: Date.now() - startTime,
    };
  }

  generateVulnerabilityReport(scanResult: ScanResult, auditResult?: DependencyAuditResult): VulnerabilityReport {
    const allIssues = [...scanResult.issues];
    const allDeps = auditResult?.dependencies ?? [];

    for (const dep of allDeps) {
      allIssues.push({
        type: "dependency",
        severity: dep.severity,
        title: dep.title,
        description: dep.description,
        recommendation: dep.recommendation,
      });
    }

    const summary = {
      critical: allIssues.filter((i) => i.severity === "critical").length,
      high: allIssues.filter((i) => i.severity === "high").length,
      medium: allIssues.filter((i) => i.severity === "medium").length,
      low: allIssues.filter((i) => i.severity === "low").length,
      total: allIssues.length,
    };

    return {
      summary,
      issues: allIssues,
      dependencies: allDeps,
      generatedAt: new Date(),
      scanDuration: scanResult.duration + (auditResult?.duration ?? 0),
    };
  }

  startScan(type: ScanHistoryEntry["type"]): string {
    const id = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.scanHistory.push({
      id,
      type,
      status: "running",
      startedAt: new Date(),
    });
    return id;
  }

  completeScan(id: string, result: ScanResult | DependencyAuditResult): void {
    const entry = this.scanHistory.find((s) => s.id === id);
    if (entry) {
      entry.status = "completed";
      entry.result = result;
      entry.completedAt = new Date();
    }
  }

  failScan(id: string): void {
    const entry = this.scanHistory.find((s) => s.id === id);
    if (entry) {
      entry.status = "failed";
      entry.completedAt = new Date();
    }
  }

  getScanHistory(limit = 20): ScanHistoryEntry[] {
    return this.scanHistory.slice(-limit);
  }

  getScanById(id: string): ScanHistoryEntry | undefined {
    return this.scanHistory.find((s) => s.id === id);
  }
}
