import type { NextFunction, Request, Response } from "express";

type Metric = { count: number; durationSeconds: number };

const httpMetrics = new Map<string, Metric>();

function metricKey(method: string, route: string, status: number): string {
  return `${method}\u0000${route}\u0000${status}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

export function recordHttpMetrics(request: Request, response: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  response.once("finish", () => {
    const routePath = typeof request.route?.path === "string" ? request.route.path : "unmatched";
    const route = routePath === "unmatched" ? routePath : `${request.baseUrl}${routePath}`;
    const key = metricKey(request.method, route, response.statusCode);
    const current = httpMetrics.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    httpMetrics.set(key, current);
  });

  next();
}

export function renderMetrics(): string {
  const memory = process.memoryUsage();
  const lines = [
    "# HELP devassess_process_uptime_seconds Process uptime in seconds.",
    "# TYPE devassess_process_uptime_seconds gauge",
    `devassess_process_uptime_seconds ${process.uptime()}`,
    "# HELP devassess_process_resident_memory_bytes Resident memory size in bytes.",
    "# TYPE devassess_process_resident_memory_bytes gauge",
    `devassess_process_resident_memory_bytes ${memory.rss}`,
    "# HELP devassess_http_requests_total Total completed HTTP requests.",
    "# TYPE devassess_http_requests_total counter",
  ];

  for (const [key, value] of httpMetrics) {
    const [method = "UNKNOWN", route = "unknown", status = "0"] = key.split("\u0000");
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
    lines.push(`devassess_http_requests_total{${labels}} ${value.count}`);
  }

  lines.push(
    "# HELP devassess_http_request_duration_seconds_sum Total HTTP request duration in seconds.",
    "# TYPE devassess_http_request_duration_seconds_sum counter",
  );
  for (const [key, value] of httpMetrics) {
    const [method = "UNKNOWN", route = "unknown", status = "0"] = key.split("\u0000");
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
    lines.push(`devassess_http_request_duration_seconds_sum{${labels}} ${value.durationSeconds}`);
  }

  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTests(): void {
  httpMetrics.clear();
}
