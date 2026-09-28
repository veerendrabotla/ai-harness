export interface SearchResult {
  file: string;
  line: number;
  content: string;
  score: number;
}

export interface SearchQuery {
  pattern: string;
  filePattern?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  maxResults?: number;
}

export interface SearchIndex {
  files: string[];
  lastUpdated: Date;
}
