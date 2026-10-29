import { chartMetrics, metricPlot } from "../tui/chartformat.ts";
import { cells, clip, wrap, quantity } from "../tui/format.ts";
import type { DashboardRow, DashboardView } from "./view.ts";

export function overviewRow(row: DashboardRow): string {
  const s = row.snapshot;
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  return `${" ".repeat(Math.min(row.depth, 12))}${row.depth ? "└ " : ""}${row.node.agent ?? "unknown agent"} / ${row.node.model ?? "unknown model"} [${row.node.sessionId}] ${row.node.status} | prompt ${quantity(valid ? s?.measurement?.tokens : undefined)}/${quantity(s?.capacityTokens)} | occupancy ${row.utilizationPercent?.toFixed(1) ?? "?"}% | trigger ${quantity(s?.policy.triggerTokens)} headroom ${quantity(row.triggerDeltaTokens)} | pressure ${row.pressure} | compact ${s?.compaction.phase ?? "unavailable"} | performance ${s?.performance?.status ?? "unavailable"} | live TPS ${quantity(row.performanceAvailable && row.performanceFreshness !== "invalid" ? s?.performance?.liveTps : undefined)} | age ${row.measurementAgeMs === undefined ? "unknown" : `${Math.floor(row.measurementAgeMs / 1000)}s`} | inventory ${row.inventoryStale ? "stale" : "fresh"}, live ${row.liveStale ? "stale" : "fresh"}, usage ${row.freshness}, performance ${row.performanceFreshness}${s?.measurement?.confidence === "approximate" ? " estimated" : ""}${s?.performance?.tokenSource === "estimated" ? " estimated TPS" : ""}${s?.performance?.partial ? " partial" : ""}${row.hidden ? ` | ${row.hidden} hidden descendants` : ""}`;
}

// Explicit paths include absent optional fields. Unknown is never rendered as zero.
export const snapshotFields = [
  "sessionId",
  "parentId",
  "agent",
  "model",
  "revision",
  "observedAt",
  "measurement.tokens",
  "measurement.at",
  "measurement.model",
  "measurement.provenance",
  "measurement.scope",
  "measurement.confidence",
  "measurement.requestId",
  "limits.input",
  "limits.context",
  "limits.output",
  "capacityTokens",
  "outputReserveTokens",
  "peakTokens",
  "policy.id",
  "policy.configured.type",
  "policy.configured.value",
  "policy.triggerTokens",
  "policy.comparison",
  "policy.reason",
  "policy.crossed",
  "compaction.phase",
  "compaction.count",
  "compaction.armed",
  "compaction.blockedReason",
  "compaction.lastAttempt",
  "compaction.lastCompleted",
  "compaction.cooldownUntil",
  "cumulativeScope",
  "cumulative.input",
  "cumulative.output",
  "cumulative.reasoning",
  "cumulative.cache.read",
  "cumulative.cache.write",
  "lastObservedActive",
  "performance.sessionCreatedAt",
  "performance.sessionOutputTokens",
  "performance.observedSince",
  "performance.at",
  "performance.status",
  "performance.partial",
  "performance.liveTps",
  "performance.averageModelTps",
  "performance.averageSessionTps",
  "performance.ttftMs",
  "performance.latestRequestTps",
  "performance.requestId",
  "performance.requestAgent",
  "performance.requestModel",
  "performance.requestOutputTokens",
  "performance.requestStartedAt",
  "performance.firstOutputAt",
  "performance.streamEndedAt",
  "performance.estimatedOutputTokens",
  "performance.modelOutputTokens",
  "performance.modelDurationMs",
  "performance.completedRequests",
  "performance.tokenSource",
] as const;

function pathValue(object: unknown, path: string): unknown {
  let value = object;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}
const scalar = (value: unknown) =>
  value === undefined || value === null
    ? "unknown/unavailable"
    : typeof value === "number" && !Number.isFinite(value)
      ? "invalid"
      : String(value);

export function terminalDetail(row: DashboardRow | undefined): string[] {
  if (!row) return ["No selected session; choose one in overview."];
  return [
    overviewRow(row),
    `Session ID: ${row.node.sessionId}`,
    `Parent ID: ${row.node.parentId ?? "unknown/unavailable"}`,
    "All snapshot fields (timestamps are Unix milliseconds):",
    ...snapshotFields.map(
      (path) => `${path}: ${scalar(pathValue(row.snapshot, path))}`,
    ),
    "Compaction count records completed lifecycle events; admission is not completion.",
  ];
}

interface Observation {
  time: number;
  value: number | undefined;
  details: Readonly<Record<string, unknown>>;
}
export function historyObservations(
  view: DashboardView,
  metricIndex: number,
): Observation[] {
  const metric = chartMetrics[metricIndex] ?? chartMetrics[0];
  return (
    view.history.result?.data.series
      .flatMap<Observation>((series) =>
        metric.source === "points"
          ? series.points.map((point) => ({
              time: point.time,
              value: point[metric.key],
              details: {
                sessionId: series.sessionId,
                ...point,
                tokenSource:
                  "per-sample source not retained; live TPS estimated; cumulative output reported; rates use matched timing",
              },
            }))
          : series.requests.map((request) => ({
              time: request.time,
              value:
                metric.key === "ttftMs"
                  ? request.ttftMs === undefined
                    ? undefined
                    : request.ttftMs / 1000
                  : request.tps,
              details: {
                sessionId: series.sessionId,
                ...request,
                tokenSource: "reported output; observed timing",
              },
            })),
      )
      .sort((a, b) => a.time - b.time) ?? []
  );
}

export function terminalHistory(
  view: DashboardView,
  width: number,
  metricIndex: number,
  sample: number,
): string[] {
  const h = view.history;
  const metric = chartMetrics[metricIndex] ?? chartMetrics[0];
  const observations = historyObservations(view, metricIndex);
  const gaps = [
    ...(h.result?.data.gaps.map((gap) => gap.time) ?? []),
    ...(h.result?.data.series.flatMap((series) =>
      series.points.filter((p) => p.breakBefore).map((p) => p.time),
    ) ?? []),
  ];
  const selected =
    observations[Math.min(sample, Math.max(0, observations.length - 1))];
  return [
    `History: ${h.status}${h.stale ? " · stale cached results" : ""} · ${h.windowMs / 60000} minutes · ${metric.label} (${metric.unit})`,
    "Left/Right metric · w window · [/] exact sample/request · Up/Down scroll",
    "Retention bounded to seven days; maximum 500 points and 500 requests per session.",
    ...h.notices,
    ...(h.summary
      ? [
          `Matched requests ${h.summary.matchedRequests}/${h.summary.observedRequests}; output ${scalar(h.summary.outputTokens)}; duration ms ${scalar(h.summary.durationMs)}; average model TPS ${scalar(h.summary.averageModelTps)}${h.summary.partial ? " · partial" : ""}`,
        ]
      : []),
    ...(h.from === undefined || h.to === undefined
      ? []
      : [
          `${new Date(h.from).toISOString()} → ${new Date(h.to).toISOString()}`,
          ...metricPlot(
            observations.map((p) => ({
              time: p.time,
              ...(p.value === undefined ? {} : { value: p.value }),
            })),
            h.from,
            h.to,
            width,
            gaps,
          ),
          "blank = no sample; ┆ = gap; observed column peaks; no interpolation",
        ]),
    ...(selected
      ? [
          `Exact ${metric.source === "points" ? "sample" : "request"} ${Math.min(sample + 1, observations.length)}/${observations.length}:`,
          ...Object.entries(selected.details).map(
            ([key, value]) => `${key}: ${scalar(value)}`,
          ),
          `Selected ${metric.label}: ${scalar(selected.value)} ${metric.unit}`,
        ]
      : [
          "No retained measurements for this metric; values unknown/unavailable.",
        ]),
  ];
}

export const terminalHelp = [
  "Context Guard standalone dashboard — keyboard help",
  "1 overview · 2 detail · 3 history · 4 models · Enter detail/chart",
  "Models: Up/Down scroll tall rows, then select · Enter aggregate chart · Esc model list · s sort",
  "Models charts: Left/Right metric · w window · [/] bucket · d request details",
  "Models list/request details: n/p pages · f exact agent filter · r refresh",
  "Up/Down or j/k: select session in overview; scroll other screens",
  "PageUp/PageDown: move by a page · Home/End: first/last",
  "Left/Right: history metric (six metrics) · w: cycle 5m/1h/24h/7d",
  "[ / ]: previous/next exact history sample or request",
  "/: search session identity · f: agent filter, then model filter (exact matches)",
  "l: owning absolute location directory; Tab cycles up to four remembered locations",
  "Remembered locations are not complete server-wide discovery.",
  "Editors: type/paste text; Backspace deletes; Enter applies; Escape cancels",
  "r: refresh · ?: help · Escape: overview · q / Ctrl+C: quit",
  "Detail scrolls through full identifiers and every exposed snapshot field.",
  "Unknown metrics are unavailable, not zero. Stale occupancy is retained; pressure is unknown.",
];

export function wrapped(lines: readonly string[], width: number) {
  const available = Math.max(1, width);
  return lines.flatMap((line) => {
    // Already-sized rows include chart gutters and hierarchy indentation.
    // Word wrapping would strip their leading spaces and shift graph columns.
    const clean = clip(line, Math.max(available, cells(line)));
    return cells(clean) <= available ? [clean] : wrap(clean, available);
  });
}
export function headerLines(view: DashboardView, width: number): string[] {
  return [
    clip(
      `Context Guard · ${view.screen} · ${view.connection} · enforcement ${view.health?.enforcement ?? "unknown"}`,
      width,
    ),
    clip(
      `Known ${view.inventory.total} · monitored ${view.inventory.monitored} · active ${view.inventory.active} · inventory ${view.inventory.stale ? "stale" : "fresh"}${view.inventory.complete ? "" : " / partial"}`,
      width,
    ),
    clip(`Location: ${view.location}`, width),
  ];
}
