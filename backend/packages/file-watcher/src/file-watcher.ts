import { watch, type FSWatcher } from "node:fs";
import type { FileEvent, WatchConfig, WatchCallback } from "./types.js";

export class FileWatcher {
  private config: WatchConfig;
  private callbacks: WatchCallback[] = [];
  private watching = false;
  private watchers: FSWatcher[] = [];
  private debounceTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(config: WatchConfig) {
    this.config = {
      paths: config.paths,
      ignored: config.ignored || [],
      debounceMs: config.debounceMs || 100,
    };
  }

  onEvent(callback: WatchCallback): void {
    this.callbacks.push(callback);
  }

  async start(): Promise<void> {
    if (this.watching) return;
    this.watching = true;

    for (const dirPath of this.config.paths) {
      const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (this.config.ignored?.some((pattern) => filename.includes(pattern))) return;

        const mappedType = eventType === "rename" ? "delete" : "modify";
        const event: FileEvent = {
          type: mappedType,
          path: filename,
          timestamp: new Date(),
        };

        // Debounce
        const timer = setTimeout(() => {
          this.callbacks.forEach((cb) => cb(event));
        }, this.config.debounceMs);
        this.debounceTimers.push(timer);
      });

      watcher.on("error", (err) => {
        console.warn("[FileWatcher] Watcher error:", err.message);
      });

      this.watchers.push(watcher);
    }
  }

  async stop(): Promise<void> {
    this.watching = false;
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    for (const timer of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers = [];
  }

  isWatching(): boolean {
    return this.watching;
  }

  emit(event: FileEvent): void {
    this.callbacks.forEach((cb) => cb(event));
  }
}
