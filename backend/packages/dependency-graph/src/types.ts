export interface GraphNode {
  id: string;
  name: string;
  type: "package" | "file" | "module";
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "imports" | "requires" | "depends";
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
