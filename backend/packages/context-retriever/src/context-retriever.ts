import type { ContextEntry, RetrievalQuery, RetrievalResult } from "./types.js";

export class ContextRetriever {
  private entries = new Map<string, ContextEntry>();

  addEntry(entry: ContextEntry): void {
    this.entries.set(entry.id, entry);
  }

  removeEntry(id: string): boolean {
    return this.entries.delete(id);
  }

  retrieve(query: RetrievalQuery): RetrievalResult {
    const startTime = Date.now();
    let results = Array.from(this.entries.values());

    if (query.sources && query.sources.length > 0) {
      results = results.filter((e) => query.sources!.includes(e.source));
    }

    results = results.map((entry) => ({
      ...entry,
      relevance: this.calculateRelevance(entry.content, query.text),
    }));

    results.sort((a, b) => b.relevance - a.relevance);

    if (query.minRelevance) {
      results = results.filter((e) => e.relevance >= query.minRelevance!);
    }

    if (query.maxResults) {
      results = results.slice(0, query.maxResults);
    }

    return {
      entries: results,
      query: query.text,
      duration: Date.now() - startTime,
    };
  }

  private calculateRelevance(content: string, query: string): number {
    const contentWords = new Set(content.toLowerCase().split(/\s+/));
    const queryWords = query.toLowerCase().split(/\s+/);

    let matches = 0;
    for (const word of queryWords) {
      if (contentWords.has(word)) {
        matches++;
      }
    }

    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
