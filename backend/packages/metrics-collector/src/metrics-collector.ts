import type { Metric, MetricType, MetricsSummary, PrometheusExport } from "./types.js";

export class MetricsCollector {
  /** Ring-buffer cap so long-lived processes never grow samples unbounded. */
  private static readonly MAX_SAMPLES = 10_000;
  private metrics: Metric[] = [];
  private counters = new Map<string, number>();

  private push(sample: Metric): void {
    this.metrics.push(sample);
    if (this.metrics.length > MetricsCollector.MAX_SAMPLES) {
      this.metrics.splice(0, this.metrics.length - MetricsCollector.MAX_SAMPLES);
    }
  }

  record(name: string, type: MetricType, value: number, labels?: Record<string, string>): void {
    this.push({
      name,
      type,
      value,
      labels,
      timestamp: new Date(),
    });

    if (type === "counter") {
      const current = this.counters.get(name) || 0;
      this.counters.set(name, current + value);
    }
  }

  increment(name: string, labels?: Record<string, string>): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + 1);

    this.push({
      name,
      type: "counter",
      value: 1,
      labels,
      timestamp: new Date(),
    });
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.push({
      name,
      type: "gauge",
      value,
      labels,
      timestamp: new Date(),
    });
  }

  timer(name: string, durationMs: number, labels?: Record<string, string>): void {
    this.push({
      name,
      type: "timer",
      value: durationMs,
      labels,
      timestamp: new Date(),
    });
  }

  getSummary(name: string): MetricsSummary | undefined {
    const metricSamples = this.metrics.filter((m) => m.name === name);
    if (metricSamples.length === 0) return undefined;

    const values = metricSamples.map((m) => m.value);
    return {
      name,
      type: metricSamples[0]?.type || "counter",
      count: values.length,
      sum: values.reduce((a, b) => a + b, 0),
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }

  getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  getMetrics(name?: string): Metric[] {
    if (name) {
      return this.metrics.filter((m) => m.name === name);
    }
    return [...this.metrics];
  }

  toPrometheus(): PrometheusExport {
    const lines: string[] = [];
    const grouped = new Map<string, Metric[]>();

    for (const m of this.metrics) {
      const existing = grouped.get(m.name);
      if (existing) {
        existing.push(m);
      } else {
        grouped.set(m.name, [m]);
      }
    }

    for (const [name, samples] of grouped) {
      const sanitizedName = name.replace(/[^a-zA-Z0-9_]/g, "_");

      if (samples.length === 1) {
        const sample = samples[0]!;
        const labels = sample.labels
          ? `{${Object.entries(sample.labels)
              .map(([k, v]) => `${k.replace(/[^a-zA-Z0-9_]/g, "_")}="${v.replace(/"/g, '\\"')}"`)
              .join(",")}}`
          : "";
        lines.push(`# TYPE ${sanitizedName} ${sample.type === "timer" ? "histogram" : sample.type}`);
        lines.push(`${sanitizedName}${labels} ${sample.value}`);
      } else {
        const latestByLabels = new Map<string, Metric>();
        for (const sample of samples) {
          const labelKey = sample.labels ? JSON.stringify(Object.entries(sample.labels).sort()) : "";
          latestByLabels.set(labelKey, sample);
        }

        const type = samples[0]!.type;
        lines.push(`# TYPE ${sanitizedName} ${type === "timer" ? "histogram" : type}`);

        for (const sample of latestByLabels.values()) {
          const labels = sample.labels
            ? `{${Object.entries(sample.labels)
                .map(([k, v]) => `${k.replace(/[^a-zA-Z0-9_]/g, "_")}="${v.replace(/"/g, '\\"')}"`)
                .join(",")}}`
            : "";
          lines.push(`${sanitizedName}${labels} ${sample.value}`);
        }
      }
    }

    return { text: lines.join("\n") + "\n", metricCount: grouped.size };
  }

  clear(): void {
    this.metrics = [];
    this.counters.clear();
  }
}
