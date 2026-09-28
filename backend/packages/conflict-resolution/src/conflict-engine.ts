import { randomUUID } from "node:crypto";
import type {
  Conflict,
  ConflictType,
  ConflictResolution,
  ResolutionStrategy,
  ConflictDetectionResult,
} from "./types.js";

export class ConflictResolutionEngine {
  private conflicts = new Map<string, Conflict>();

  detectConflict(
    filePath: string,
    currentContent: string,
    incomingContent: string,
    type: ConflictType = "file"
  ): ConflictDetectionResult {
    if (currentContent === incomingContent) {
      return { hasConflict: false, conflicts: [], filePath };
    }

    const conflict: Conflict = {
      id: randomUUID(),
      type,
      filePath,
      currentContent,
      incomingContent,
      timestamp: new Date(),
      resolved: false,
    };

    this.conflicts.set(conflict.id, conflict);

    return {
      hasConflict: true,
      conflicts: [conflict],
      filePath,
    };
  }

  detectMergeConflicts(content: string): ConflictDetectionResult {
    const conflictMarkerRegex = /^<{7}\s*\n([\s\S]*?)\n={7}\s*\n([\s\S]*?)\n>{7}\s*$/gm;
    const conflicts: Conflict[] = [];
    let match;

    while ((match = conflictMarkerRegex.exec(content)) !== null) {
      const conflict: Conflict = {
        id: randomUUID(),
        type: "merge",
        filePath: "",
        currentContent: match[1] || "",
        incomingContent: match[2] || "",
        timestamp: new Date(),
        resolved: false,
      };
      conflicts.push(conflict);
      this.conflicts.set(conflict.id, conflict);
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts,
      filePath: "",
    };
  }

  parseConflictHunks(content: string): Array<{ startLine: number; endLine: number; current: string; incoming: string }> {
    const lines = content.split("\n");
    const hunks: Array<{ startLine: number; endLine: number; current: string; incoming: string }> = [];
    let i = 0;

    while (i < lines.length) {
      if (lines[i]?.startsWith("<<<<<<<")) {
        const startLine = i;
        const currentLines: string[] = [];
        const incomingLines: string[] = [];
        i++;

        while (i < lines.length && !lines[i]?.startsWith("=======")) {
          currentLines.push(lines[i] || "");
          i++;
        }
        i++;

        while (i < lines.length && !lines[i]?.startsWith(">>>>>>>")) {
          incomingLines.push(lines[i] || "");
          i++;
        }

        hunks.push({
          startLine,
          endLine: i,
          current: currentLines.join("\n"),
          incoming: incomingLines.join("\n"),
        });
      }
      i++;
    }

    return hunks;
  }

  async resolve(
    conflictId: string,
    strategy: ResolutionStrategy,
    resolvedBy: string,
    manualContent?: string
  ): Promise<ConflictResolution> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) throw new Error(`Conflict ${conflictId} not found`);
    if (conflict.resolved) throw new Error(`Conflict ${conflictId} already resolved`);

    let resolvedContent: string;

    switch (strategy) {
      case "accept_current":
        resolvedContent = conflict.currentContent;
        break;
      case "accept_incoming":
        resolvedContent = conflict.incomingContent;
        break;
      case "accept_both":
        resolvedContent = conflict.currentContent + "\n" + conflict.incomingContent;
        break;
      case "ai_resolve":
        resolvedContent = await this.aiResolve(conflict);
        break;
      case "manual":
        if (!manualContent) throw new Error("Manual resolution requires content");
        resolvedContent = manualContent;
        break;
      default:
        throw new Error(`Unknown strategy: ${strategy}`);
    }

    const resolution: ConflictResolution = {
      strategy,
      resolvedContent,
      resolvedBy,
      timestamp: new Date(),
      auditTrail: [{
        action: "resolve",
        timestamp: new Date(),
        userId: resolvedBy,
        details: { strategy, conflictId },
      }],
    };

    conflict.resolved = true;
    conflict.resolution = resolution;

    return resolution;
  }

  getConflict(id: string): Conflict | undefined {
    return this.conflicts.get(id);
  }

  getUnresolvedConflicts(): Conflict[] {
    return Array.from(this.conflicts.values()).filter((c) => !c.resolved);
  }

  getResolvedConflicts(): Conflict[] {
    return Array.from(this.conflicts.values()).filter((c) => c.resolved);
  }

  clearResolved(): void {
    for (const [id, conflict] of this.conflicts) {
      if (conflict.resolved) {
        this.conflicts.delete(id);
      }
    }
  }

  private async aiResolve(conflict: Conflict): Promise<string> {
    const currentLines = conflict.currentContent.split("\n");
    const incomingLines = conflict.incomingContent.split("\n");
    const merged: string[] = [];
    const maxLen = Math.max(currentLines.length, incomingLines.length);

    for (let i = 0; i < maxLen; i++) {
      const current = currentLines[i];
      const incoming = incomingLines[i];

      if (current === incoming) {
        merged.push(current || "");
      } else if (current !== undefined && incoming !== undefined) {
        merged.push(current || "");
        if (!merged.includes(incoming)) {
          merged.push(incoming || "");
        }
      } else {
        merged.push(current || incoming || "");
      }
    }

    return merged.join("\n");
  }
}
