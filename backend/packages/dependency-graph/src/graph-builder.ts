import type { GraphNode, GraphEdge, DependencyGraph } from "./types.js";

export class DependencyGraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    this.edges.push(edge);
  }

  build(): DependencyGraph {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges],
    };
  }

  getDependencies(nodeId: string): GraphNode[] {
    return this.edges
      .filter((e) => e.from === nodeId)
      .map((e) => this.nodes.get(e.to))
      .filter((n): n is GraphNode => n !== undefined);
  }

  getDependents(nodeId: string): GraphNode[] {
    return this.edges
      .filter((e) => e.to === nodeId)
      .map((e) => this.nodes.get(e.from))
      .filter((n): n is GraphNode => n !== undefined);
  }

  findCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): void => {
      if (stack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }

      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      stack.add(nodeId);
      path.push(nodeId);

      const deps = this.edges.filter((e) => e.from === nodeId);
      for (const dep of deps) {
        dfs(dep.to, [...path]);
      }

      stack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      dfs(nodeId, []);
    }

    return cycles;
  }

  getTopologicalOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const deps = this.edges.filter((e) => e.from === nodeId);
      for (const dep of deps) {
        visit(dep.to);
      }

      order.push(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    return order;
  }

  clear(): void {
    this.nodes.clear();
    this.edges = [];
  }
}
