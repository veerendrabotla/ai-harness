export interface Event<T = unknown> {
  type: string;
  payload: T;
  timestamp: Date;
  source?: string;
}

export type EventHandler<T = unknown> = (event: Event<T>) => void | Promise<void>;

export interface EventBusConfig {
  maxListeners?: number;
  enableHistory?: boolean;
  historySize?: number;
}
