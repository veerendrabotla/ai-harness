export type ConflictType = "merge" | "file" | "checkpoint" | "session_fork" | "concurrent_edit";

export type ResolutionStrategy = "accept_current" | "accept_incoming" | "accept_both" | "ai_resolve" | "manual";

export interface Conflict {
  id: string;
  type: ConflictType;
  filePath: string;
  currentContent: string;
  incomingContent: string;
  currentAuthor?: string;
  incomingAuthor?: string;
  timestamp: Date;
  resolved: boolean;
  resolution?: ConflictResolution;
}

export interface ConflictHunk {
  startLine: number;
  endLine: number;
  currentLines: string[];
  incomingLines: string[];
}

export interface ConflictResolution {
  strategy: ResolutionStrategy;
  resolvedContent: string;
  resolvedBy: string;
  timestamp: Date;
  auditTrail: AuditEntry[];
}

export interface AuditEntry {
  action: string;
  timestamp: Date;
  userId?: string;
  details?: Record<string, unknown>;
}

export interface ConflictDetectionResult {
  hasConflict: boolean;
  conflicts: Conflict[];
  filePath: string;
}
