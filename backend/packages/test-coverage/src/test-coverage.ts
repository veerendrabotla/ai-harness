import type { CoverageReport, FileCoverage, CoverageMetric, CoverageSummary, CoverageConfig } from "./types.js";

export class TestCoverageTracker {
  private config: CoverageConfig;
  private reports: CoverageReport[] = [];

  constructor(config?: CoverageConfig) {
    this.config = {
      threshold: config?.threshold ?? 80,
      excludePatterns: config?.excludePatterns ?? ["node_modules", "dist", "*.test.*", "*.spec.*"],
      includePatterns: config?.includePatterns ?? ["**/*.ts", "**/*.tsx", "**/*.js"],
    };
  }

  private createEmptySummary(): CoverageSummary {
    return {
      total: { total: 0, covered: 0, skipped: 0, pct: 0 },
      coveredFiles: 0,
      totalFiles: 0,
    };
  }

  createEmptyReport(): CoverageReport {
    return {
      files: [],
      summary: this.createEmptySummary(),
      timestamp: new Date(),
    };
  }

  addFileCoverage(report: CoverageReport, fileCoverage: FileCoverage): CoverageReport {
    const existing = report.files.findIndex((f) => f.path === fileCoverage.path);
    if (existing >= 0) {
      report.files[existing] = fileCoverage;
    } else {
      report.files.push(fileCoverage);
    }
    report.summary = this.calculateSummary(report.files);
    return report;
  }

  parseLcov(lcovContent: string): CoverageReport {
    const files: FileCoverage[] = [];
    const lines = lcovContent.split("\n");

    let currentFile: Partial<FileCoverage> | null = null;

    for (const line of lines) {
      if (line.startsWith("SF:")) {
        currentFile = { path: line.slice(3) };
      } else if (line.startsWith("LF:") && currentFile) {
        currentFile.statements = { total: parseInt(line.slice(3)), covered: 0, skipped: 0, pct: 0 };
      } else if (line.startsWith("LH:") && currentFile && currentFile.statements) {
        currentFile.statements.covered = parseInt(line.slice(3));
        currentFile.statements.pct = (currentFile.statements.covered / currentFile.statements.total) * 100;
      } else if (line.startsWith("end_of_record") && currentFile) {
        files.push(currentFile as FileCoverage);
        currentFile = null;
      }
    }

    return {
      files,
      summary: this.calculateSummary(files),
      timestamp: new Date(),
    };
  }

  private calculateSummary(files: FileCoverage[]): CoverageSummary {
    const emptyMetric: CoverageMetric = { total: 0, covered: 0, skipped: 0, pct: 0 };

    const totalStatements = files.reduce((acc, f) => ({
      total: acc.total + (f.statements?.total || 0),
      covered: acc.covered + (f.statements?.covered || 0),
      skipped: acc.skipped + (f.statements?.skipped || 0),
      pct: 0,
    }), emptyMetric);

    if (totalStatements.total > 0) {
      totalStatements.pct = (totalStatements.covered / totalStatements.total) * 100;
    }

    return {
      total: totalStatements,
      coveredFiles: files.filter((f) => (f.statements?.pct || 0) > 0).length,
      totalFiles: files.length,
    };
  }

  meetsThreshold(report: CoverageReport): boolean {
    return report.summary.total.pct >= (this.config.threshold || 0);
  }

  getUncoveredFiles(report: CoverageReport, threshold?: number): FileCoverage[] {
    const minThreshold = threshold ?? this.config.threshold ?? 80;
    return report.files.filter((f) => (f.statements?.pct || 0) < minThreshold);
  }

  storeReport(report: CoverageReport): void {
    this.reports.push(report);
    if (this.reports.length > 10) {
      this.reports.shift();
    }
  }

  getReportHistory(): CoverageReport[] {
    return [...this.reports];
  }
}
