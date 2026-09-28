import type { RefactorSuggestion, RefactorResult, RefactorConfig } from "./types.js";

export class RefactorAssist {
  private config: RefactorConfig;

  constructor(config?: RefactorConfig) {
    this.config = {
      autoApply: config?.autoApply ?? false,
      minConfidence: config?.minConfidence ?? 0.8,
      excludePatterns: config?.excludePatterns ?? [],
    };
  }

  analyze(code: string, filename?: string): RefactorSuggestion[] {
    if (filename && this.shouldExclude(filename)) {
      return [];
    }

    const suggestions: RefactorSuggestion[] = [];

    // Check for long functions
    const lines = code.split("\n");
    if (lines.length > 50) {
      suggestions.push({
        type: "extract",
        description: "Function is too long, consider extracting parts",
        location: { line: 1, column: 0 },
        confidence: 0.9,
      });
    }

    // Check for duplicate code patterns
    const duplicatePatterns = this.findDuplicatePatterns(code);
    for (const pattern of duplicatePatterns) {
      suggestions.push({
        type: "extract",
        description: `Duplicate code pattern found: ${pattern}`,
        location: { line: 1, column: 0 },
        confidence: 0.85,
      });
    }

    return suggestions;
  }

  applyRefactor(code: string, suggestion: RefactorSuggestion): RefactorResult {
    if (suggestion.type === "extract" && suggestion.description.includes("Duplicate code pattern")) {
      return this.extractDuplicate(code, suggestion);
    }
    if (suggestion.type === "extract" && suggestion.description.includes("too long")) {
      return this.extractLongFunction(code, suggestion);
    }
    return { original: code, refactored: code, changes: 0 };
  }

  private extractDuplicate(code: string, suggestion: RefactorSuggestion): RefactorResult {
    const lines = code.split("\n");
    const startLine = (suggestion.location.line ?? 1) - 1;
    const pattern = lines.slice(startLine, startLine + 3).join("\n");
    if (!pattern) return { original: code, refactored: code, changes: 0 };

    const functionName = `extracted_${startLine + 1}`;
    const indent = (lines[startLine]?.match(/^(\s*)/)?.[1]) ?? "";

    // Find all occurrences of the pattern after the first
    const occurrences: number[] = [];
    for (let i = startLine + 3; i < lines.length - 2; i++) {
      if (lines.slice(i, i + 3).join("\n") === pattern) {
        occurrences.push(i);
      }
    }

    if (occurrences.length === 0) return { original: code, refactored: code, changes: 0 };

    // Build refactored code: extract to function, replace duplicates
    const extractedFunction = `${indent}function ${functionName}() {\n${indent}  // extracted\n${pattern.split("\n").map(l => `${indent}  ${l.trimStart()}`).join("\n")}\n${indent}}\n`;

    let newCode = code.replace(pattern, `${functionName}();`);
    for (const idx of occurrences.reverse()) {
      const block = lines.slice(idx, idx + 3).join("\n");
      newCode = newCode.replace(block, `${functionName}();`);
    }

    // Prepend the extracted function
    const lastImportIdx = newCode.lastIndexOf("\nimport ");
    const insertIdx = lastImportIdx !== -1 ? newCode.indexOf("\n", lastImportIdx + 1) + 1 : 0;
    newCode = newCode.slice(0, insertIdx) + extractedFunction + newCode.slice(insertIdx);

    return {
      original: code,
      refactored: newCode,
      changes: occurrences.length + 1,
    };
  }

  private extractLongFunction(code: string, _suggestion: RefactorSuggestion): RefactorResult {
    const lines = code.split("\n");
    const midpoint = Math.floor(lines.length / 2);

    // Find a good split point (blank line or closing brace)
    let splitAt = midpoint;
    for (let i = midpoint; i < Math.min(midpoint + 10, lines.length); i++) {
      if (lines[i]?.trim() === "" || lines[i]?.trim() === "}") {
        splitAt = i;
        break;
      }
    }

    // Find the function name from the code (look for function/const/arrow patterns)
    const funcMatch = code.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=)|(?:export\s+(?:default\s+)?(?:function\s+)?(\w+))/);
    const funcName = funcMatch?.[1] || funcMatch?.[2] || funcMatch?.[3] || "processData";
    const extractedName = `${funcName}Part2`;

    // Detect the indentation level
    const indent = (lines[0]?.match(/^(\s*)/)?.[1]) ?? "";
    const bodyIndent = indent + "  ";

    // Extract the bottom half into a new function
    const bottomLines = lines.slice(splitAt);
    const topLines = lines.slice(0, splitAt);

    // Build the extracted function
    const extractedFunction = `${indent}function ${extractedName}() {\n${bottomLines.map(l => `${bodyIndent}${l.trimStart()}`).join("\n")}\n${indent}}\n`;

    // Replace bottom half in original with a call to extracted function
    const refactored = [...topLines, `${bodyIndent}${extractedName}();`, "", extractedFunction].join("\n");

    return {
      original: code,
      refactored,
      changes: 1,
    };
  }

  private findDuplicatePatterns(code: string): string[] {
    const patterns: string[] = [];
    const lines = code.split("\n").map((l) => l.trim());

    for (let i = 0; i < lines.length - 3; i++) {
      const pattern = lines.slice(i, i + 3).join("\n");
      const rest = lines.slice(i + 3).join("\n");

      if (rest.includes(pattern) && pattern.length > 20) {
        patterns.push(`Lines ${i + 1}-${i + 3}`);
        i += 3;
      }
    }

    return patterns;
  }

  private shouldExclude(filename: string): boolean {
    return this.config.excludePatterns?.some((pattern) => filename.includes(pattern)) ?? false;
  }
}
