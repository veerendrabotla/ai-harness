import type { ASTNode, ASTParseResult, ASTError, ASTStats, ASTQuery } from "./types.js";

export class ASTAnalyzer {
  private cache = new Map<string, ASTParseResult>();

  parse(sourceCode: string, filename?: string): ASTParseResult {
    if (filename && this.cache.has(filename)) {
      return this.cache.get(filename)!;
    }

    const errors: ASTError[] = [];
    const lines = sourceCode.split("\n");
    const root: ASTNode = {
      type: "Program",
      start: 0,
      end: sourceCode.length,
      children: [],
      loc: { line: 1, column: 0 },
    };

    const stats: ASTStats = {
      totalNodes: 0,
      depth: 0,
      functions: 0,
      classes: 0,
      imports: 0,
      exports: 0,
      linesOfCode: lines.length,
    };

    this.analyzeNode(root, sourceCode, stats, errors);

    const result: ASTParseResult = { ast: root, errors, stats };

    if (filename) {
      this.cache.set(filename, result);
    }

    return result;
  }

  query(root: ASTNode, query: ASTQuery, maxDepth: number = 10): ASTNode[] {
    const results: ASTNode[] = [];

    const traverse = (node: ASTNode, depth: number): void => {
      if (depth > maxDepth) return;

      if (node.type === query.type) {
        if (!query.name || node.name === query.name) {
          results.push(node);
        }
      }

      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    };

    traverse(root, 0);
    return results;
  }

  findFunctions(root: ASTNode): ASTNode[] {
    return this.query(root, { type: "FunctionDeclaration" })
      .concat(this.query(root, { type: "ArrowFunction" }));
  }

  findClasses(root: ASTNode): ASTNode[] {
    return this.query(root, { type: "ClassDeclaration" });
  }

  findImports(root: ASTNode): ASTNode[] {
    return this.query(root, { type: "ImportDeclaration" });
  }

  findExports(root: ASTNode): ASTNode[] {
    return this.query(root, { type: "ExportDeclaration" });
  }

  getCallGraph(root: ASTNode): { caller: string; callee: string }[] {
    const calls: { caller: string; callee: string }[] = [];
    const functions = this.findFunctions(root);

    for (const func of functions) {
      const callExprs = this.query(func, { type: "CallExpression" });
      for (const call of callExprs) {
        if (func.name) {
          calls.push({
            caller: func.name,
            callee: call.name || "anonymous",
          });
        }
      }
    }

    return calls;
  }

  private analyzeNode(node: ASTNode, source: string, stats: ASTStats, _errors: ASTError[]): void {
    stats.totalNodes++;

    const funcMatches = source.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g);
    if (funcMatches) stats.functions = funcMatches.length;

    const classMatches = source.match(/(?:export\s+)?class\s+(\w+)/g);
    if (classMatches) stats.classes = classMatches.length;

    const importMatches = source.match(/import\s+.*from\s+['"]/g);
    if (importMatches) stats.imports = importMatches.length;

    const exportMatches = source.match(/export\s+(?:default\s+)?(?:function|class|const|let|var)/g);
    if (exportMatches) stats.exports = exportMatches.length;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
