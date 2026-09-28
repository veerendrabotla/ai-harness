export interface ContextEntry {
  id: string;
  content: string;
  source: string;
  relevance: number;
  metadata?: Record<string, unknown>;
}

export interface RetrievalQuery {
  text: string;
  maxResults?: number;
  minRelevance?: number;
  sources?: string[];
}

export interface RetrievalResult {
  entries: ContextEntry[];
  query: string;
  duration: number;
}
