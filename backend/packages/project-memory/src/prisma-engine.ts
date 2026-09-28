/**
 * Prisma-backed Project Memory Engine.
 * Persists project memories to the database instead of in-memory storage.
 */
import type { PrismaClient } from "@prisma/client";
import type {
  ProjectMemory,
  MemoryCategory,
  MemoryQuery,
  MemoryInsight,
  ProjectMemoryEngine,
  MemoryStats,
} from "./types.js";

export class PrismaProjectMemoryEngine implements ProjectMemoryEngine {
  constructor(private readonly prisma: PrismaClient) {}

  async remember(
    projectId: string,
    memory: Omit<ProjectMemory, "id" | "createdAt" | "updatedAt" | "lastAccessedAt" | "accessCount">,
  ): Promise<ProjectMemory> {
    const now = new Date();
    const row = await this.prisma.projectMemory.create({
      data: {
        projectId,
        category: memory.category,
        key: memory.key,
        value: memory.value,
        context: memory.context,
        confidence: memory.confidence,
        source: memory.source,
        references: memory.references,
        accessCount: 0,
        lastAccessedAt: now,
      },
    });
    return this.toProjectMemory(row);
  }

  async query(query: MemoryQuery): Promise<ProjectMemory[]> {
    const where: Record<string, unknown> = {
      projectId: query.projectId,
    };
    if (query.category) {
      where.category = query.category;
    }
    const rows = await this.prisma.projectMemory.findMany({
      where: where as never,
      orderBy: [{ confidence: "desc" }, { accessCount: "desc" }],
      take: query.limit ?? 50,
    });
    if (query.keywords && query.keywords.length > 0) {
      const keywords = query.keywords.map((k) => k.toLowerCase());
      return rows.filter((m) => {
        const text = `${m.key} ${m.value} ${m.context}`.toLowerCase();
        return keywords.some((k) => text.includes(k));
      }).map((r) => this.toProjectMemory(r));
    }
    return rows.map((r) => this.toProjectMemory(r));
  }

  async getRelevant(projectId: string, context: string, limit = 20): Promise<MemoryInsight[]> {
    const keywords = context
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 10);

    const memories = await this.query({ projectId, limit: 100 });
    const insights: MemoryInsight[] = [];

    for (const memory of memories) {
      const text = `${memory.key} ${memory.value} ${memory.context}`.toLowerCase();
      let relevance = 0;
      let reason = "";

      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          relevance += 0.2;
          if (!reason) reason = `Matches keyword: "${keyword}"`;
        }
      }

      // Boost by confidence
      relevance += memory.confidence * 0.3;

      if (relevance > 0.1) {
        insights.push({ memory, relevance: Math.min(relevance, 1), reason });
      }
    }

    // Sort by relevance and return top results
    insights.sort((a, b) => b.relevance - a.relevance);
    return insights.slice(0, limit);
  }

  async reinforce(memoryId: string, _evidence: string): Promise<void> {
    await this.prisma.projectMemory.update({
      where: { id: memoryId },
      data: {
        confidence: { increment: 0.05 },
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });
  }

  async decay(projectId: string, maxAgeDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.projectMemory.updateMany({
      where: {
        projectId,
        lastAccessedAt: { lt: cutoff },
        confidence: { gt: 0.1 },
      },
      data: {
        confidence: { decrement: 0.1 },
      },
    });
    return result.count;
  }

  async stats(projectId: string): Promise<MemoryStats> {
    const total = await this.prisma.projectMemory.count({ where: { projectId } });
    const rows = await this.prisma.projectMemory.findMany({
      where: { projectId },
      select: { category: true, confidence: true, createdAt: true, lastAccessedAt: true },
    });

    const byCategory: Record<MemoryCategory, number> = {
      architecture_decision: 0,
      coding_convention: 0,
      previous_bug: 0,
      user_preference: 0,
      deployment_config: 0,
      recurring_failure: 0,
      lesson_learned: 0,
      file_pattern: 0,
      dependency_note: 0,
      performance_note: 0,
    };

    let totalConfidence = 0;
    let oldestMemory: Date | null = null;
    let newestMemory: Date | null = null;

    for (const row of rows) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      totalConfidence += row.confidence;
      if (!oldestMemory || row.createdAt < oldestMemory) oldestMemory = row.createdAt;
      if (!newestMemory || row.createdAt > newestMemory) newestMemory = row.createdAt;
    }

    return {
      total,
      byCategory,
      averageConfidence: total > 0 ? totalConfidence / total : 0,
      oldestMemory,
      newestMemory,
    };
  }

  private toProjectMemory(row: {
    id: string;
    projectId: string;
    category: MemoryCategory;
    key: string;
    value: string;
    context: string;
    confidence: number;
    source: string;
    references: unknown;
    accessCount: number;
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt: Date;
  }): ProjectMemory {
    return {
      id: row.id,
      projectId: row.projectId,
      category: row.category,
      key: row.key,
      value: row.value,
      context: row.context,
      confidence: row.confidence,
      source: row.source as ProjectMemory["source"],
      references: (row.references as string[]) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastAccessedAt: row.lastAccessedAt,
      accessCount: row.accessCount,
    };
  }
}
