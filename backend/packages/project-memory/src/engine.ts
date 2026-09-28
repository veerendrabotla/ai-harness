/**
 * Project Memory Engine.
 * Stores and retrieves project-specific knowledge that helps the agent
 * make better decisions over time.
 */
import { randomUUID } from "node:crypto";
import type {
  ProjectMemory,
  MemoryCategory,
  MemoryQuery,
  MemoryInsight,
  ProjectMemoryEngine,
  MemoryStats,
} from "./types.js";

export class InMemoryProjectMemoryEngine implements ProjectMemoryEngine {
  private memories = new Map<string, ProjectMemory>();

  async remember(
    projectId: string,
    memory: Omit<ProjectMemory, "id" | "createdAt" | "updatedAt" | "lastAccessedAt" | "accessCount">,
  ): Promise<ProjectMemory> {
    const now = new Date();
    const entry: ProjectMemory = {
      ...memory,
      id: randomUUID(),
      projectId,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    };
    this.memories.set(entry.id, entry);
    return entry;
  }

  async query(query: MemoryQuery): Promise<ProjectMemory[]> {
    let results = Array.from(this.memories.values()).filter((m) => m.projectId === query.projectId);

    if (query.category) {
      results = results.filter((m) => m.category === query.category);
    }

    if (query.keywords && query.keywords.length > 0) {
      const keywords = query.keywords.map((k) => k.toLowerCase());
      results = results.filter((m) => {
        const text = `${m.key} ${m.value} ${m.context}`.toLowerCase();
        return keywords.some((k) => text.includes(k));
      });
    }

    // Sort by confidence and recency
    results.sort((a, b) => {
      const scoreA = a.confidence * 0.7 + (a.accessCount / 100) * 0.3;
      const scoreB = b.confidence * 0.7 + (b.accessCount / 100) * 0.3;
      return scoreB - scoreA;
    });

    return results.slice(0, query.limit ?? 50);
  }

  async getRelevant(projectId: string, context: string, limit: number = 10): Promise<MemoryInsight[]> {
    const contextLower = context.toLowerCase();
    const contextWords = contextLower.split(/\s+/).filter((w) => w.length > 2);

    const allMemories = Array.from(this.memories.values()).filter((m) => m.projectId === projectId);
    const insights: MemoryInsight[] = [];

    for (const memory of allMemories) {
      const memoryText = `${memory.key} ${memory.value} ${memory.context}`.toLowerCase();
      let relevance = 0;

      // Keyword matching
      for (const word of contextWords) {
        if (memoryText.includes(word)) {
          relevance += 0.2;
        }
      }

      // Category boosting
      const categoryBoosts: Record<MemoryCategory, number> = {
        architecture_decision: 0.15,
        coding_convention: 0.1,
        previous_bug: 0.2,
        user_preference: 0.15,
        deployment_config: 0.1,
        recurring_failure: 0.25,
        lesson_learned: 0.2,
        file_pattern: 0.1,
        dependency_note: 0.1,
        performance_note: 0.15,
      };
      relevance += categoryBoosts[memory.category] ?? 0;

      // Confidence boost
      relevance += memory.confidence * 0.2;

      if (relevance > 0.1) {
        insights.push({
          memory,
          relevance: Math.min(relevance, 1),
          reason: this.generateRelevanceReason(memory, contextWords),
        });
      }
    }

    // Sort by relevance
    insights.sort((a, b) => b.relevance - a.relevance);

    // Update access counts
    for (const insight of insights.slice(0, limit)) {
      insight.memory.lastAccessedAt = new Date();
      insight.memory.accessCount++;
    }

    return insights.slice(0, limit);
  }

  async reinforce(memoryId: string, evidence: string): Promise<void> {
    const memory = this.memories.get(memoryId);
    if (!memory) return;

    // Increase confidence based on reinforcement
    memory.confidence = Math.min(memory.confidence + 0.1, 1);
    memory.updatedAt = new Date();
    memory.value += ` [Reinforced: ${evidence}]`;
  }

  async decay(projectId: string, maxAgeDays: number = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    let decayed = 0;
    for (const memory of this.memories.values()) {
      if (memory.projectId === projectId && memory.lastAccessedAt < cutoff) {
        memory.confidence = Math.max(memory.confidence - 0.1, 0);
        decayed++;
      }
    }
    return decayed;
  }

  async stats(projectId: string): Promise<MemoryStats> {
    const projectMemories = Array.from(this.memories.values()).filter((m) => m.projectId === projectId);

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
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for (const memory of projectMemories) {
      byCategory[memory.category]++;
      totalConfidence += memory.confidence;
      if (!oldest || memory.createdAt < oldest) oldest = memory.createdAt;
      if (!newest || memory.createdAt > newest) newest = memory.createdAt;
    }

    return {
      total: projectMemories.length,
      byCategory,
      averageConfidence: projectMemories.length > 0 ? totalConfidence / projectMemories.length : 0,
      oldestMemory: oldest,
      newestMemory: newest,
    };
  }

  /**
   * Clear all memories (for testing).
   */
  clearAll(): void {
    this.memories.clear();
  }

  /**
   * Generate a human-readable reason for relevance.
   */
  private generateRelevanceReason(memory: ProjectMemory, contextWords: string[]): string {
    const memoryText = `${memory.key} ${memory.value} ${memory.context}`.toLowerCase();
    const matchedWords = contextWords.filter((w) => memoryText.includes(w));

    if (matchedWords.length > 0) {
      return `Matches keywords: ${matchedWords.join(", ")}`;
    }
    return `Relevant ${memory.category.replace(/_/g, " ")}`;
  }
}
