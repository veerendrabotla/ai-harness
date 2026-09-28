import type { DependencyInfo, AuditResult, LicenseIssue, AuditConfig } from "./types.js";

export class DependencyAuditor {
  private config: AuditConfig;

  constructor(config?: AuditConfig) {
    this.config = {
      includeDev: config?.includeDev ?? true,
      allowedLicenses: config?.allowedLicenses ?? ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"],
      severityThreshold: config?.severityThreshold ?? "medium",
    };
  }

  async audit(packageJsonContent: string): Promise<AuditResult> {
    const packageJson = JSON.parse(packageJsonContent);
    const dependencies: DependencyInfo[] = [];

    const allDeps = {
      ...packageJson.dependencies,
      ...(this.config.includeDev ? packageJson.devDependencies : {}),
    };

    for (const [name, version] of Object.entries(allDeps || {})) {
      const dep: DependencyInfo = {
        name,
        version: version as string,
        license: await this.getLicense(name),
        deprecated: false,
        vulnerabilities: [],
      };

      dependencies.push(dep);
    }

    const licenseIssues = this.checkLicenses(dependencies);
    const vulnCounts = this.countVulnerabilities(dependencies);

    return {
      dependencies,
      totalVulnerabilities: vulnCounts.total,
      criticalCount: vulnCounts.critical,
      highCount: vulnCounts.high,
      mediumCount: vulnCounts.medium,
      lowCount: vulnCounts.low,
      outdatedCount: dependencies.filter((d) => d.latest && d.version !== d.latest).length,
      licenseIssues,
    };
  }

  private async getLicense(packageName: string): Promise<string> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return "unknown";
      const pkg = (await response.json()) as { license?: string | { type?: string } };
      if (typeof pkg.license === "string") return pkg.license;
      if (typeof pkg.license === "object" && pkg.license?.type) return pkg.license.type;
      return "unknown";
    } catch (err) {
      console.error("[Dependency] License fetch failed for package:", err);
      return "unknown";
    }
  }

  private checkLicenses(dependencies: DependencyInfo[]): LicenseIssue[] {
    const issues: LicenseIssue[] = [];

    for (const dep of dependencies) {
      if (!this.config.allowedLicenses!.includes(dep.license)) {
        issues.push({
          package: dep.name,
          license: dep.license,
          reason: `License "${dep.license}" is not in allowed list`,
        });
      }
    }

    return issues;
  }

  private countVulnerabilities(dependencies: DependencyInfo[]): {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  } {
    let critical = 0, high = 0, medium = 0, low = 0;

    for (const dep of dependencies) {
      for (const vuln of dep.vulnerabilities) {
        switch (vuln.severity) {
          case "critical": critical++; break;
          case "high": high++; break;
          case "medium": medium++; break;
          case "low": low++; break;
        }
      }
    }

    return { total: critical + high + medium + low, critical, high, medium, low };
  }

  getRiskLevel(result: AuditResult): "critical" | "high" | "medium" | "low" | "safe" {
    if (result.criticalCount > 0) return "critical";
    if (result.highCount > 0) return "high";
    if (result.mediumCount > 0) return "medium";
    if (result.lowCount > 0) return "low";
    return "safe";
  }
}
