export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueType = "vulnerability" | "secret" | "misconfiguration" | "dependency";

export interface SecurityIssue {
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
}

export interface ScanResult {
  issues: SecurityIssue[];
  filesScanned: number;
  duration: number;
}

export interface ScanConfig {
  scanDependencies?: boolean;
  scanSecrets?: boolean;
  severityThreshold?: IssueSeverity;
}

export interface DependencyAuditEntry {
  name: string;
  version: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  recommendation: string;
  fixAvailable: boolean;
}

export interface DependencyAuditResult {
  dependencies: DependencyAuditEntry[];
  totalChecked: number;
  vulnerabilities: number;
  duration: number;
}

export interface VulnerabilityReport {
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  issues: SecurityIssue[];
  dependencies: DependencyAuditEntry[];
  generatedAt: Date;
  scanDuration: number;
}

export interface ScanHistoryEntry {
  id: string;
  type: "secret" | "dependency" | "full";
  status: "running" | "completed" | "failed";
  result?: ScanResult | DependencyAuditResult;
  startedAt: Date;
  completedAt?: Date;
}
