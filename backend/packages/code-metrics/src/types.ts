export interface CodeMetrics {
  filename: string;
  linesOfCode: number;
  complexity: ComplexityMetrics;
  maintainability: MaintainabilityMetrics;
  quality: QualityScore;
}

export interface ComplexityMetrics {
  cyclomatic: number;
  cognitive: number;
  halsteadVolume: number;
  nestingDepth: number;
}

export interface MaintainabilityMetrics {
  index: number;
  volume: number;
  difficulty: number;
  effort: number;
  timeToCode: number;
  deliveredBugs: number;
}

export interface QualityScore {
  overall: number;
  readability: number;
  modularity: number;
  testability: number;
}

export interface MetricsConfig {
  maxComplexity?: number;
  maxNesting?: number;
  maxLineLength?: number;
}
