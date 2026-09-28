import type { CodeMetrics, ComplexityMetrics, MaintainabilityMetrics, QualityScore, MetricsConfig } from "./types.js";

export class CodeMetricsAnalyzer {
  private config: MetricsConfig;

  constructor(config?: MetricsConfig) {
    this.config = {
      maxComplexity: config?.maxComplexity ?? 10,
      maxNesting: config?.maxNesting ?? 4,
      maxLineLength: config?.maxLineLength ?? 120,
    };
  }

  analyze(sourceCode: string, filename: string): CodeMetrics {
    const lines = sourceCode.split("\n");
    const linesOfCode = lines.filter((l) => l.trim().length > 0 && !l.trim().startsWith("//")).length;

    const complexity = this.analyzeComplexity(sourceCode);
    const maintainability = this.analyzeMaintainability(sourceCode, complexity);
    const quality = this.analyzeQuality(sourceCode, lines, complexity);

    return {
      filename,
      linesOfCode,
      complexity,
      maintainability,
      quality,
    };
  }

  private analyzeComplexity(source: string): ComplexityMetrics {
    let cyclomatic = 1;
    let nestingDepth = 0;
    let maxNesting = 0;

    const keywords = ["if", "else if", "while", "for", "case", "catch", "&&", "||", "?"];
    for (const keyword of keywords) {
      const matches = source.match(new RegExp(`\\b${keyword}\\b|\\${keyword}`, "g"));
      if (matches) cyclomatic += matches.length;
    }

    const lines = source.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith("{")) {
        nestingDepth++;
        maxNesting = Math.max(maxNesting, nestingDepth);
      } else if (trimmed.startsWith("}")) {
        nestingDepth = Math.max(0, nestingDepth - 1);
      }
    }

    const operators = source.match(/[+\-*/%=<>!&|^~?:]+/g) || [];
    const operands = source.match(/\b[a-zA-Z_]\w*\b/g) || [];
    const halsteadVolume = Math.log2(operators.length + 1) * Math.log2(operands.length + 1);

    return {
      cyclomatic,
      cognitive: this.calculateCognitiveComplexity(source),
      halsteadVolume,
      nestingDepth: maxNesting,
    };
  }

  private calculateCognitiveComplexity(source: string): number {
    let complexity = 0;
    let nestingLevel = 0;

    const lines = source.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.match(/\b(if|else if|for|while|catch)\b/)) {
        complexity += 1 + nestingLevel;
      }

      if (trimmed.endsWith("{")) nestingLevel++;
      if (trimmed.startsWith("}")) nestingLevel = Math.max(0, nestingLevel - 1);

      if (trimmed.match(/\b(&&|\|\|)\b/)) complexity++;
    }

    return complexity;
  }

  private analyzeMaintainability(source: string, complexity: ComplexityMetrics): MaintainabilityMetrics {
    const lines = source.split("\n").length;
    const operators = (source.match(/[+\-*/%=<>!&|^~?:]+/g) || []).length;
    const operands = (source.match(/\b[a-zA-Z_]\w*\b/g) || []).length;

    const volume = Math.log2(operators + 1) * Math.log2(operands + 1) * lines;
    const difficulty = (operators / 2) * (operands / 2);
    const effort = volume * difficulty;
    const timeToCode = effort / 18;
    const deliveredBugs = volume / 3000;

    const index = Math.max(0, Math.min(171, 171 - 5.2 * Math.log(volume) - 0.23 * complexity.cyclomatic - 16.2 * Math.log(lines)));

    return {
      index,
      volume,
      difficulty,
      effort,
      timeToCode,
      deliveredBugs,
    };
  }

  private analyzeQuality(source: string, lines: string[], complexity: ComplexityMetrics): QualityScore {
    const longLines = lines.filter((l) => l.length > this.config.maxLineLength!).length;
    const readability = Math.max(0, 100 - longLines * 2 - complexity.nestingDepth * 5);

    const functions = (source.match(/(?:export\s+)?(?:async\s+)?function\s+\w+/g) || []).length;
    const avgLinesPerFunction = lines.length / Math.max(1, functions);
    const modularity = Math.max(0, 100 - Math.abs(avgLinesPerFunction - 20) * 2);

    const hasTests = source.includes("describe(") || source.includes("it(") || source.includes("test(");
    const testability = hasTests ? 90 : 50;

    const overall = Math.round((readability + modularity + testability) / 3);

    return { overall, readability: Math.round(readability), modularity: Math.round(modularity), testability };
  }

  getComplexityRating(complexity: number): "low" | "medium" | "high" | "very_high" {
    if (complexity <= 5) return "low";
    if (complexity <= 10) return "medium";
    if (complexity <= 20) return "high";
    return "very_high";
  }
}
