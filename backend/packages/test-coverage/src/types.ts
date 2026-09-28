export interface CoverageReport {
  files: FileCoverage[];
  summary: CoverageSummary;
  timestamp: Date;
}

export interface FileCoverage {
  path: string;
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
}

export interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

export interface CoverageSummary {
  total: CoverageMetric;
  coveredFiles: number;
  totalFiles: number;
}

export interface CoverageConfig {
  threshold?: number;
  excludePatterns?: string[];
  includePatterns?: string[];
}
