export type MetricType = "counter" | "gauge" | "histogram" | "timer";

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
  timestamp: Date;
}

export interface MetricsSummary {
  name: string;
  type: MetricType;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}

export interface PrometheusExport {
  text: string;
  metricCount: number;
}
