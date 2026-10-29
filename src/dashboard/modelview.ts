import { metricPlot } from "../tui/chartformat.ts";
import type { ModelSummary } from "../modelanalytics.ts";
import type { DashboardView } from "./view.ts";

export const modelMetrics = [
  { key: "averageTps", label: "Weighted request TPS", unit: "t/s", divisor: 1 },
  { key: "medianTtftMs", label: "TTFT median ~", unit: "s", divisor: 1000 },
  { key: "p95TtftMs", label: "TTFT p95 ~", unit: "s", divisor: 1000 },
  {
    key: "completedRequests",
    label: "Completed requests",
    unit: "requests",
    divisor: 1,
  },
  { key: "outputTokens", label: "Reported output", unit: "tokens", divisor: 1 },
] as const;
function metricValue(
  summary: Readonly<ModelSummary> | undefined,
  metric: (typeof modelMetrics)[number],
) {
  if (metric.key === "outputTokens" && !summary?.tpsRequests) return undefined;
  const value = summary?.[metric.key];
  return value === undefined ? undefined : value / metric.divisor;
}
const number = (n: number | undefined) =>
  n === undefined ? "?" : Number.isInteger(n) ? String(n) : n.toFixed(2);
const stats = (m: Readonly<ModelSummary>) =>
  `${m.sessions} sessions · ${m.completedRequests} completed · weighted TPS ${number(m.averageTps)} · TTFT median/p95 ${number(m.medianTtftMs === undefined ? undefined : m.medianTtftMs / 1000)}/${number(m.p95TtftMs === undefined ? undefined : m.p95TtftMs / 1000)}s ~`;

export function terminalModelRow(
  model: Readonly<ModelSummary>,
  focused: boolean,
) {
  return [
    `${focused ? "> " : "  "}${model.model ?? "unknown model attribution"}`,
    `  ${stats(model)}`,
    `  TPS eligible ${model.tpsRequests}; TTFT eligible ${model.ttftRequests}; partial ${model.partialRequests}; legacy attribution ${model.legacyAttributionRequests}`,
  ];
}

export function terminalModels(
  view: DashboardView,
  width: number,
  detail: boolean,
  metricIndex: number,
  sample: number,
  focus: number,
  requests: boolean,
): string[] {
  const state = view.models;
  const result = state.result;
  const lines = [
    `Models · ${state.status}${state.stale ? " · STALE cached results" : ""} · ${state.windowMs / 60000} minutes · retained history`,
    `Agent: ${(result?.agent ?? view.filters.agent) || "all"} · sort ${state.sort} · location ${view.location}`,
    "4 Models · Enter chart · Esc model list/overview · w window · f agent · r refresh",
  ];
  if (state.status === "unsupported")
    return [
      ...lines,
      "Models requires a server with context-guard.analytics.v1; update the server plugin. Overview and session history remain available.",
    ];
  if (state.status === "disabled")
    return [
      ...lines,
      "Retained performance recording is disabled on this server.",
    ];
  if (!result)
    return [
      ...lines,
      state.status === "loading"
        ? "Loading model aggregates…"
        : "Model analytics unavailable; press r to retry.",
    ];
  lines.push(
    `${new Date(result.from).toISOString()} → ${new Date(result.to).toISOString()} (UTC; completion time)`,
  );
  const partial =
    result.coverage.partial ||
    result.metadata.skippedBytes > 0 ||
    result.metadata.malformedRecords > 0 ||
    result.gaps.length > 0 ||
    result.omittedGaps > 0;
  lines.push(
    `Coverage: ${partial ? "PARTIAL" : "bounded observations"}; 64 MiB scan limit; ${result.coverage.maxRequests} request identities maximum; no pre-observation reconstruction.`,
  );
  lines.push(
    `Archive retained since ${result.metadata.retainedFrom === undefined ? "unknown" : new Date(result.metadata.retainedFrom).toISOString()}; snapshot observed at ${new Date(result.generatedAt).toISOString()}.`,
  );
  lines.push(
    `Scan: ${result.coverage.scannedRecords} records; ${result.metadata.skippedBytes} bytes skipped; ${result.metadata.malformedRecords} malformed; ${result.coverage.conflictingRequests} conflicting; ${result.coverage.incompleteRequests} incomplete; ${result.coverage.invalidTimingRequests} invalid timing; gaps ${result.gaps.length}${result.omittedGaps ? ` (+${result.omittedGaps} omitted)` : ""}.`,
  );
  if (!detail) {
    lines.push(
      `Model page ${state.modelPage + 1} · ${result.totalModels} models · Up/Down scroll/select · n/p pages · s sort`,
    );
    if (!result.models.length)
      lines.push("No completed requests match this range and agent filter.");
    result.models.forEach((model, index) => {
      lines.push(...terminalModelRow(model, index === focus));
    });
    return lines;
  }
  const selected = result.selected;
  if (!selected)
    return [
      ...lines,
      "No completed requests for this model in the selected range.",
    ];
  lines.push(
    `Model: ${selected.model ?? "unknown model attribution"}`,
    stats(selected),
  );
  lines.push(
    `Reported output ${number(selected.tpsRequests ? selected.outputTokens : undefined)} tokens; matched duration ${number(selected.tpsRequests ? selected.durationMs / 1000 : undefined)}s; TPS eligible/excluded ${selected.tpsRequests}/${selected.excludedTpsRequests}; TTFT eligible/excluded ${selected.ttftRequests}/${selected.excludedTtftRequests}; partial ${selected.partialRequests}; legacy attribution ${selected.legacyAttributionRequests}`,
  );
  if (requests) {
    lines.push(
      `Request page ${state.requestPage + 1} · n/p pages · d chart · completed stream ≠ task success`,
    );
    result.requests.forEach((r) =>
      lines.push(
        `Request ${r.requestId} · session ${r.sessionId}`,
        `Completed ${new Date(r.completedAt).toISOString()} · ${r.agent ?? "unknown agent"} · output ${number(r.outputTokens)} · duration ${number((r.completedAt - r.startedAt) / 1000)}s · TTFT ${number(r.ttftMs === undefined ? undefined : r.ttftMs / 1000)}s ~ · ${r.attribution}${r.partial ? " · partial" : ""}`,
      ),
    );
    return lines;
  }
  const metric = modelMetrics[metricIndex] ?? modelMetrics[0];
  lines.push(
    `‹ ${metric.label} (${metric.unit}) › · Left/Right metric · [/] bucket · d requests`,
  );
  lines.push(
    ...metricPlot(
      result.buckets.map((bucket) => {
        const value = metricValue(bucket.summary, metric);
        return {
          time: (bucket.from + bucket.to) / 2,
          ...(value === undefined ? {} : { value }),
        };
      }),
      result.from,
      result.to,
      width,
      result.gaps,
      true,
    ),
  );
  lines.push(
    "UTC buckets · blank = no eligible observations · ┆ = retained gap; partial coverage may hide other gaps.",
  );
  lines.push(
    "TPS = reported output / summed matched request durations (includes TTFT); concurrent durations add. In-flight requests enter after stream completion.",
  );
  const bucket =
    result.buckets[Math.min(sample, Math.max(0, result.buckets.length - 1))];
  if (bucket) {
    lines.push(
      `Bucket ${Math.min(sample + 1, result.buckets.length)}/${result.buckets.length}: ${new Date(bucket.from).toISOString()} → ${new Date(bucket.to).toISOString()}`,
    );
    lines.push(
      bucket.summary
        ? stats(bucket.summary)
        : "No eligible observations; measurements unknown.",
    );
    lines.push(
      `Selected ${metric.label}: ${number(metricValue(bucket.summary, metric))} ${metric.unit}`,
    );
    if (bucket.summary)
      lines.push(
        `Bucket eligibility: TPS ${bucket.summary.tpsRequests}/${bucket.summary.completedRequests}; TTFT ${bucket.summary.ttftRequests}/${bucket.summary.completedRequests}; partial ${bucket.summary.partialRequests}`,
      );
  }
  return lines;
}
