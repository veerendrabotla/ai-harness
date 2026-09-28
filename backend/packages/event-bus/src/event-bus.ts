import type { Event, EventHandler, EventBusConfig } from "./types.js";

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private history: Event[] = [];
  private config: EventBusConfig;

  constructor(config?: EventBusConfig) {
    this.config = {
      maxListeners: config?.maxListeners ?? 10,
      enableHistory: config?.enableHistory ?? false,
      historySize: config?.historySize ?? 100,
    };
  }

  on<T = unknown>(type: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(type) || [];

    if (handlers.length >= this.config.maxListeners!) {
      throw new Error(`Max listeners (${this.config.maxListeners}) exceeded for event: ${type}`);
    }

    handlers.push(handler as EventHandler);
    this.handlers.set(type, handlers);
  }

  off<T = unknown>(type: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(type);
    if (!handlers) return;

    const index = handlers.indexOf(handler as EventHandler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  }

  async emit<T = unknown>(type: string, payload: T, source?: string): Promise<void> {
    const event: Event<T> = {
      type,
      payload,
      timestamp: new Date(),
      source,
    };

    if (this.config.enableHistory) {
      this.history.push(event);
      if (this.history.length > this.config.historySize!) {
        this.history.shift();
      }
    }

    const handlers = this.handlers.get(type) || [];
    await Promise.all(handlers.map((handler) => handler(event)));
  }

  once<T = unknown>(type: string, handler: EventHandler<T>): void {
    const wrapper: EventHandler<T> = (event) => {
      handler(event);
      this.off(type, wrapper);
    };
    this.on(type, wrapper);
  }

  getHistory(type?: string): Event[] {
    if (type) {
      return this.history.filter((e) => e.type === type);
    }
    return [...this.history];
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.length || 0;
  }

  removeAllListeners(type?: string): void {
    if (type) {
      this.handlers.delete(type);
    } else {
      this.handlers.clear();
    }
  }
}
