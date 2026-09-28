export interface DependencyInfo {
  name: string;
  version: string;
  latest?: string;
  license: string;
  deprecated: boolean;
  vulnerabilities: Vulnerability[];
}

export interface Vulnerability {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  fixedIn?: string;
}

export interface AuditResult {
  dependencies: DependencyInfo[];
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  outdatedCount: number;
  licenseIssues: LicenseIssue[];
}

export interface LicenseIssue {
  package: string;
  license: string;
  reason: string;
}

export interface AuditConfig {
  includeDev?: boolean;
  allowedLicenses?: string[];
  severityThreshold?: "critical" | "high" | "medium" | "low";
}
