/**
 * Project Memory Types.
 * The platform should remember things like:
 * - Architecture decisions
 * - Coding conventions
 * - Previous bugs
 * - User preferences for a project
 * - Deployment configuration
 * - Recurring failures
 * - Lessons learned from previous agent runs
 *
 * So every new task starts smarter than the previous one.
 */

export type MemoryCategory =
  | "architecture_decision"
  | "coding_convention"
  | "previous_bug"
  | "user_preference"
  | "deployment_config"
  | "recurring_failure"
  | "lesson_learned"
  | "file_pattern"
  | "dependency_note"
  | "performance_note";

export interface ProjectMemory {
  id: string;
  projectId: string;
  category: MemoryCategory;
  key: string;
  value: string;
  context: string;
  confidence: number; // 0-1, how confident we are in this memory
  source: "agent_observation" | "user_input" | "code_analysis" | "error_pattern";
  references: string[]; // file paths, commit hashes, etc.
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
}

export interface MemoryQuery {
  projectId: string;
  category?: MemoryCategory;
  keywords?: string[];
  limit?: number;
}

export interface MemoryInsight {
  memory: ProjectMemory;
  relevance: number; // 0-1
  reason: string; // why this memory is relevant
}

export interface ProjectMemoryEngine {
  /**
   * Store a memory.
   */
  remember(projectId: string, memory: Omit<ProjectMemory, "id" | "createdAt" | "updatedAt" | "lastAccessedAt" | "accessCount">): Promise<ProjectMemory>;

  /**
   * Query memories for a project.
   */
  query(query: MemoryQuery): Promise<ProjectMemory[]>;

  /**
   * Get relevant memories for a context.
   * Uses keyword matching and category filtering.
   */
  getRelevant(projectId: string, context: string, limit?: number): Promise<MemoryInsight[]>;

  /**
   * Update a memory's confidence based on new evidence.
   */
  reinforce(memoryId: string, evidence: string): Promise<void>;

  /**
   * Decay old memories that haven't been accessed.
   */
  decay(projectId: string, maxAgeDays?: number): Promise<number>;

  /**
   * Get memory statistics for a project.
   */
  stats(projectId: string): Promise<MemoryStats>;
}

export interface MemoryStats {
  total: number;
  byCategory: Record<MemoryCategory, number>;
  averageConfidence: number;
  oldestMemory: Date | null;
  newestMemory: Date | null;
}
