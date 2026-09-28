export type NodeType =
  | "Program" | "FunctionDeclaration" | "ClassDeclaration"
  | "MethodDeclaration" | "ArrowFunction" | "VariableDeclaration"
  | "ImportDeclaration" | "ExportDeclaration" | "IfStatement"
  | "ForStatement" | "WhileStatement" | "TryStatement"
  | "CallExpression" | "MemberExpression" | "Identifier"
  | "Literal" | "TemplateLiteral" | " JSXElement"
  | "TypeAnnotation" | "InterfaceDeclaration" | "TypeAliasDeclaration";

export interface ASTNode {
  type: NodeType;
  start: number;
  end: number;
  children: ASTNode[];
  parent?: ASTNode;
  name?: string;
  value?: unknown;
  loc?: { line: number; column: number };
}

export interface ASTParseResult {
  ast: ASTNode;
  errors: ASTError[];
  stats: ASTStats;
}

export interface ASTError {
  message: string;
  line: number;
  column: number;
  severity: "error" | "warning";
}

export interface ASTStats {
  totalNodes: number;
  depth: number;
  functions: number;
  classes: number;
  imports: number;
  exports: number;
  linesOfCode: number;
}

export interface ASTQuery {
  type: NodeType;
  name?: string;
  maxDepth?: number;
}
