import type { SearchResult, SearchQuery, SearchIndex } from "./types.js";

export class CodeSearch {
  private index: SearchIndex = { files: [], lastUpdated: new Date() };
  private fileContents = new Map<string, string>();

  indexFile(path: string, content: string): void {
    if (!this.index.files.includes(path)) {
      this.index.files.push(path);
    }
    this.fileContents.set(path, content);
    this.index.lastUpdated = new Date();
  }

  removeFile(path: string): void {
    this.index.files = this.index.files.filter((f) => f !== path);
    this.fileContents.delete(path);
  }

  search(query: SearchQuery): SearchResult[] {
    const results: SearchResult[] = [];
    const pattern = query.regex
      ? new RegExp(query.pattern, query.caseSensitive ? "g" : "gi")
      : new RegExp(
          query.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          query.caseSensitive ? "g" : "gi"
        );

    for (const file of this.index.files) {
      if (query.filePattern) {
        // Respect caseSensitive for filePattern as well (fallback to case-insensitive when false/undefined)
        const haystack = query.caseSensitive ? file : file.toLowerCase();
        const needle = query.caseSensitive ? query.filePattern : query.filePattern.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }

      const content = this.fileContents.get(file);
      if (!content) continue;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] || "";
        const matches = line.match(pattern);

        if (matches) {
          let score = matches.length;

          if (query.wholeWord) {
            const wordPattern = new RegExp(`\\b${query.pattern}\\b`, query.caseSensitive ? "g" : "gi");
            const wordMatches = line.match(wordPattern);
            if (!wordMatches) continue;
            score = wordMatches.length;
          }

          results.push({
            file,
            line: i + 1,
            content: line.trim(),
            score,
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);

    if (query.maxResults) {
      return results.slice(0, query.maxResults);
    }

    return results;
  }

  getIndex(): SearchIndex {
    return { ...this.index };
  }

  clear(): void {
    this.index = { files: [], lastUpdated: new Date() };
    this.fileContents.clear();
  }
}
