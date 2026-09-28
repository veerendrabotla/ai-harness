export type FileEventType = "create" | "modify" | "delete";

export interface FileEvent {
  type: FileEventType;
  path: string;
  timestamp: Date;
}

export interface WatchConfig {
  paths: string[];
  ignored?: string[];
  debounceMs?: number;
}

export type WatchCallback = (event: FileEvent) => void;
