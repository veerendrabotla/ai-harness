/**
 * Agentic Search — Lovable-inspired intent → search plan → surgical context.
 *
 * Instead of sending broad context windows, the agent generates targeted search
 * terms from the edit intent, scores candidate files/lines, and injects only
 * the single most relevant file+line range. Reduces token cost and improves
 * precision (90-95% target file accuracy in Lovable's pattern).
 */

/** A scored candidate file for a surgical edit. */
export interface SearchCandidate {
  path: string;
  relevanceScore: number;
  matchedTerms: string[];
  lineHint?: { line: number; reason: string };
}

/** The search plan generated from edit intent. */
export interface AgenticSearchPlan {
  /** Targeted search terms (e.g. ["hero", "background", "bg-"]) */
  searchTerms: string[];
  /** What kind of edit is planned */
  editType: "UPDATE_COMPONENT" | "CREATE_FILE" | "DELETE_FILE" | "REFACTOR" | "FIX_BUG" | "GENERAL";
  /** Confidence 0-1 in the search plan */
  confidence: number;
  /** Human-readable reason for the plan */
  reason: string;
}

/**
 * Generate an agentic search plan from the task goal + available file list.
 * Lightweight heuristic version — no LLM call needed for term extraction.
 * (A heavier LLM manifest-scan variant can be added later.)
 */
export function generateSearchPlan(
  goal: string,
  fileList: string[],
  constraints?: string | null,
): AgenticSearchPlan {
  const normalizedGoal = goal.toLowerCase();
  const terms = extractSearchTerms(normalizedGoal);

  // Detect edit type from goal keywords
  let editType: AgenticSearchPlan["editType"] = "GENERAL";
  if (/create|new file|scaffold|generate/i.test(goal)) editType = "CREATE_FILE";
  else if (/delete|remove.*file/i.test(goal)) editType = "DELETE_FILE";
  else if (/refactor|rename|move/i.test(goal)) editType = "REFACTOR";
  else if (/fix|bug|error|issue|broken/i.test(goal)) editType = "FIX_BUG";
  else if (/update|change|modify|edit|add.*to/i.test(goal)) editType = "UPDATE_COMPONENT";

  // Confidence: higher when we have specific file-path mentions or component names
  let confidence = 0.5;
  if (terms.some((t) => fileList.some((f) => f.toLowerCase().includes(t)))) confidence = 0.7;
  if (/src\//.test(goal) || /\.(tsx?|jsx?|py|go|rs)\b/.test(goal)) confidence = 0.85;

  if (constraints) {
    // Add terms from constraints that look like file paths or component names
    const constraintTerms = extractSearchTerms(constraints.toLowerCase());
    for (const t of constraintTerms) {
      if (!terms.includes(t) && fileList.some((f) => f.toLowerCase().includes(t))) {
        terms.push(t);
      }
    }
  }

  return {
    searchTerms: terms,
    editType,
    confidence,
    reason: `Terms [${terms.join(", ")}] extracted from goal for ${editType} targeting ${terms.some((t) => fileList.some((f) => f.includes(t))) ? "specific" : "general"} files`,
  };
}

function extractSearchTerms(text: string): string[] {
  // Extract meaningful terms: filter stop words, short tokens, and noise
  const STOP = new Set([
    "the", "and", "for", "with", "from", "this", "that", "have", "should",
    "would", "could", "when", "where", "what", "which", "about", "into",
    "through", "being", "been", "also", "please", "need", "want", "make",
    "create", "update", "change", "modify", "generate", "build", "implement",
    "feature", "function", "component", "should", "will", "must", "can",
  ]);

  const tokens = text
    .replace(/[^a-z0-9_\-./]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));

  // Deduplicate, keep order of first occurrence
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      terms.push(t);
    }
  }

  // Also extract compound terms (e.g. "hero background" → "hero", "background", "hero-background")
  // Keep top 8 terms
  return terms.slice(0, 8);
}

/**
 * Score files against the search plan and return ranked candidates.
 * Single-target mode: returns the single best file. Multi-file: top N.
 */
export function scoreFiles(
  plan: AgenticSearchPlan,
  fileList: string[],
  opts: { maxResults?: number } = {},
): SearchCandidate[] {
  const maxResults = opts.maxResults ?? 1;
  const candidates: SearchCandidate[] = [];

  for (const path of fileList) {
    const lower = path.toLowerCase();
    let score = 0;
    const matched: string[] = [];

    for (const term of plan.searchTerms) {
      if (lower.includes(term)) {
        score += 10;
        matched.push(term);
      }
      // Bonus for exact segment match (e.g. "hero" matches "hero.tsx" better than "superhero.tsx")
      const segments = lower.split(/[/.\-_]/);
      if (segments.includes(term)) {
        score += 5;
      }
    }

    // Bonus for recently-relevant file types based on edit type
    if (plan.editType === "UPDATE_COMPONENT" && /\.(tsx|jsx|vue|svelte)$/.test(path)) score += 2;
    if (plan.editType === "FIX_BUG" && /\.(ts|js|py|go|rs)$/.test(path)) score += 2;

    if (score > 0) {
      candidates.push({ path, relevanceScore: score, matchedTerms: matched });
    }
  }

  candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return candidates.slice(0, maxResults);
}

/**
 * Build the surgical instruction block to inject as context.
 * Tells the model to focus on the single primary file + line.
 */
export function buildSurgicalBlock(
  plan: AgenticSearchPlan,
  target: SearchCandidate | null,
): string {
  if (!target) {
    return `## Surgical Context\nNo primary file identified for terms [${plan.searchTerms.join(", ")}]. Use broad context.`;
  }

  const lines: string[] = [
    `## Surgical Context — ${plan.editType} (confidence: ${(plan.confidence * 100).toFixed(0)}%)`,
    `Search terms: [${plan.searchTerms.join(", ")}]`,
    `Primary target: \`${target.path}\` (score: ${target.relevanceScore}, matched: [${target.matchedTerms.join(", ")}])`,
  ];

  if (target.lineHint) {
    lines.push(`Line hint: line ${target.lineHint.line} — ${target.lineHint.reason}`);
  }

  lines.push(`\nInstruction: Make ONLY the change described in the goal. Focus on the primary target file. Do not modify unrelated files.`);

  return lines.join("\n");
}
