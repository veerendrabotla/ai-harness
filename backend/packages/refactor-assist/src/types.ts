export type RefactorType = "extract" | "rename" | "move" | "inline" | "simplify" | "optimize";

export interface RefactorSuggestion {
  type: RefactorType;
  description: string;
  location: { line: number; column: number };
  confidence: number;
}

export interface RefactorResult {
  original: string;
  refactored: string;
  changes: number;
}

export interface RefactorConfig {
  autoApply?: boolean;
  minConfidence?: number;
  excludePatterns?: string[];
}
