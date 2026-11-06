import { historyStatusLines } from "../historyclient.ts";
import { chartMetrics, metricPlot } from "../tui/chartformat.ts";
import { cells, clip, wrap, quantity, detailLines } from "../tui/format.ts";
import {
  connectionLabel,
  freshnessLabel,
  monitorStatusLines,
  panelStatus,
  pressureLabel,
  thresholdDistance,
} from "../tui/statusformat.ts";
import type { DashboardRow, DashboardView } from "./view.ts";
import { compactionLabel, panelStatuses } from "../tui/panelformat.ts";

export function diagnosticRow(row: DashboardRow): string {
  const s = row.snapshot;
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  return `${" ".repeat(Math.min(row.depth, 12))}${row.depth ? "└ " : ""}${row.node.agent ?? "unknown agent"} / ${row.node.model ?? "unknown model"} [${row.node.sessionId}] ${row.node.status} | ${row.freshness === "stale" ? "Last measured" : "Context"} ${quantity(valid ? s?.measurement?.tokens : undefined)}/${quantity(s?.capacityTokens)} | occupancy ${row.utilizationPercent?.toFixed(1) ?? "?"}% | threshold ${quantity(s?.policy.triggerTokens)} · ${thresholdDistance(row)} | ${pressureLabel(row)} | compact ${s?.compaction.phase ?? "unavailable"} | performance ${s?.performance?.status ?? "unavailable"} | live TPS ${quantity(row.performanceAvailable && row.performanceFreshness !== "invalid" ? s?.performance?.liveTps : undefined)} | age ${row.measurementAgeMs === undefined ? "unknown" : `${Math.floor(row.measurementAgeMs / 1000)}s`} | inventory ${row.inventoryStale ? "stale" : "fresh"}, live ${row.liveStale ? "stale" : "fresh"}, usage ${row.freshness}, performance ${row.performanceFreshness}${s?.measurement?.confidence === "approximate" ? " estimated" : ""}${s?.performance?.tokenSource === "estimated" ? " estimated TPS" : ""}${s?.performance?.partial ? " partial" : ""}${row.hidden ? ` | ${row.hidden} hidden descendants` : ""}`;
}

function pad(value: string, width: number): string {
  const text = clip(value, width);
  return text + " ".repeat(Math.max(0, width - cells(text)));
}

function overviewColumns(
  identity: string,
  state: string,
  context: string,
  threshold: string,
  width: number,
): string {
  return `${pad(identity, width - 44)} ${pad(state, 7)} ${pad(context, 7)} ${pad(threshold, 27)}`;
}

export function overviewHeading(width: number): string[] {
  return width >= 72
    ? [overviewColumns("Agent / model", "State", "Context", "Threshold", width)]
    : [];
}

/** Stable ID suffixes when unique; position is the bounded fallback. */
export function overviewLabels(rows: readonly DashboardRow[]): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const suffixes = rows.map((row) =>
    [...segmenter.segment(clip(row.node.sessionId, 4096))]
      .slice(-8)
      .map((part) => part.segment)
      .join(""),
  );
  const counts = new Map<string, number>();
  for (const suffix of suffixes)
    counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
  return suffixes.map((suffix, index) =>
    counts.get(suffix) === 1 ? suffix : `#${index + 1}`,
  );
}

/** Each row is already cell-bounded; overview cards never wrap diagnostics. */
export function overviewRowLines(
  row: DashboardRow,
  width: number,
  selected: boolean,
  label: string,
  position: number,
  maxLines = 3,
): string[] {
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const percent = `${valid && row.snapshot?.measurement?.confidence === "approximate" ? "~" : ""}${valid && row.utilizationPercent !== undefined ? Math.round(row.utilizationPercent) : "?"}%`;
  const context = `${row.freshness === "stale" ? "Last measured " : ""}${percent}`;
  const distance = thresholdDistance(row, true);
  const threshold = (
    distance === "At threshold · requires more"
      ? "At threshold; requires more"
      : distance
  ).replace(" · Threshold reached", " · reached");
  const state =
    width < 28
      ? {
          running: "RUN",
          idle: "IDLE",
          completed: "DONE",
          failed: "FAIL",
          unknown: "?",
        }[row.node.status]
      : panelStatuses[row.node.status];
  const identityWidth =
    width >= 72 ? width - 44 : Math.max(1, width - cells(state) - 1);
  const marker = selected ? "> " : "  ";
  const tag = width >= 100 ? ` [${label}]` : ` #${position + 1}`;
  // Indentation must never consume the agent's entire identity budget.
  const indent =
    row.depth && identityWidth >= 22
      ? `${" ".repeat(Math.min(row.depth, Math.max(0, Math.floor(identityWidth / 8) - 1)))}└ `
      : "";
  const name = `${row.node.agent ?? "unknown agent"}${width >= 40 ? ` / ${row.node.model ?? "unknown model"}` : ""}`;
  const identity =
    marker +
    indent +
    clip(name, Math.max(1, identityWidth - cells(marker + indent + tag))) +
    tag;
  const metric = `${context} context · ${threshold}`;
  const shortThreshold = threshold
    .replace("pressure unknown", "?")
    .replace("At threshold; requires more", "At; needs more")
    .replace(" · Near threshold", " near")
    .replace(" · reached", " reached")
    .replace("Threshold reached", "Reached");
  const shortMetric = `${context} · T ${shortThreshold}`;
  const pressure =
    row.freshness !== "fresh" || row.pressure === "unknown"
      ? "Threshold ?"
      : row.pressure === "crossed"
        ? "Reached"
        : row.triggerDeltaTokens === 0
          ? "At; needs more"
          : row.pressure === "near"
            ? "Near threshold"
            : "Below threshold";
  const metrics = [metric, shortMetric, `${context} · ${pressure}`];
  const fittedMetric = metrics.find((line) => cells(line) <= width);
  const lines =
    width >= 72
      ? [
          overviewColumns(
            identity,
            state,
            row.freshness === "stale" ? "Last" : percent,
            threshold,
            width,
          ),
        ]
      : [`${pad(identity, identityWidth)} ${state}`, fittedMetric ?? context];
  const lifecycle = compactionLabel(row);
  const exceptions = [
    ...(width >= 72 && row.freshness === "stale" ? [context] : []),
    ...(width < 72 && !fittedMetric ? [pressure] : []),
    ...(row.node.status === "failed" ? ["Agent failed"] : []),
    ...(row.node.interrupted ? ["Interrupted"] : []),
    ...(lifecycle
      ? [cells(lifecycle) <= width - 6 ? lifecycle : compactionLabel(row, true)]
      : []),
    ...(row.freshness !== "fresh" ? [freshnessLabel(row)] : []),
    ...(row.inventoryStale ? ["Inventory stale"] : []),
    ...(row.liveStale ? ["Live data stale"] : []),
    ...(row.hidden ? [`${row.hidden} hidden descendants`] : []),
  ].filter((value): value is string => value !== undefined);
  if (exceptions.length) {
    let shown = 1;
    let text = exceptions[0] ?? "";
    while (
      shown < exceptions.length &&
      cells(text + " · " + exceptions[shown]) <= width - 6
    ) {
      text += " · " + exceptions[shown++];
    }
    const more =
      shown < exceptions.length ? ` +${exceptions.length - shown}` : "";
    lines.push(clip(text, Math.max(0, width - cells(more))) + more);
  }
  return lines.slice(0, Math.max(1, maxLines)).map((line) => clip(line, width));
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
    `Session ID: ${row.node.sessionId}`,
    ...detailLines(row, 4096, false, row.measurementAgeMs),
    ...(row.node.interrupted ? ["Agent execution interrupted"] : []),
    "Diagnostic codes and accounting:",
    diagnosticRow(row),
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
  if (!view.history.result?.enabled) return [];
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
    `History: ${h.status} · ${h.windowMs / 60000} minutes · ${metric.label} (${metric.unit})`,
    ...historyStatusLines(h),
    "Left/Right metric · w window · [/] exact sample/request · Up/Down scroll",
    "Retention bounded to seven days; maximum 500 points and 500 requests per session.",
    ...h.notices,
    ...(h.result?.enabled && h.summary
      ? [
          `Matched requests ${h.summary.matchedRequests}/${h.summary.observedRequests}; output ${scalar(h.summary.outputTokens)}; duration ms ${scalar(h.summary.durationMs)}; average model TPS ${scalar(h.summary.averageModelTps)}${h.summary.partial ? " · partial" : ""}`,
        ]
      : []),
    ...(!h.result?.enabled || h.from === undefined || h.to === undefined
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
      : h.status === "ready" && h.result?.enabled
        ? [
            "No retained measurements for this metric; values unknown/unavailable.",
          ]
        : []),
  ];
}

export const terminalHelp = [
  "Context Guard standalone dashboard — keyboard help",
  "1 overview · 2 detail · 3 history · 4 models · Enter detail/chart",
  "Models: Up/Down scroll tall rows, then select · Enter aggregate chart · Esc model list · s sort",
  "Models charts: Left/Right metric · w window · [/] bucket · d request details",
  "Models list/request details: n/p pages · f exact agent filter · r refresh",
  "Up/Down or j/k: select session in overview; scroll other screens",
  "Overview: compact columns/cards; Enter or 2 for full identity and diagnostics",
  "Overview PageUp/PageDown selects by visible rows; #N identifies a row in narrow layouts",
  "Overview T means threshold; +N means more diagnostics in Details",
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
export function headerLines(
  view: DashboardView,
  width: number,
  height = 24,
): string[] {
  const compact = width < 28;
  const small = height < 18;
  // Below the usable status geometry, retain a bounded header so even a
  // one-cell Models viewport can still scroll through every row.
  if (width < 16 || height < 8)
    return [
      clip(connectionLabel(view.connection, true), width),
      clip(panelStatus(view.health), width),
      clip(`Location: ${view.location}`, width),
    ];
  return [
    clip(
      `${connectionLabel(view.connection, compact)} · ${compact ? (width >= 20 ? "Context Guard" : "Guard") : `Context Guard · ${view.screen}`}`,
      width,
    ),
    ...monitorStatusLines(
      view.connection,
      view.health,
      view.rows.some((row) => row.snapshot?.measurement !== undefined),
      compact,
    ).flatMap((line) => wrap(line, width)),
    ...(small
      ? [
          clip(
            `Selected: ${view.selected?.node.agent ?? view.selectedSessionId ?? "none"}`,
            width,
          ),
        ]
      : [
          clip(
            `Known ${view.inventory.total} · monitored ${view.inventory.monitored} · active ${view.inventory.active} · inventory ${view.inventory.stale ? "stale" : "fresh"}${view.inventory.complete ? "" : " / partial"}`,
            width,
          ),
          clip(`Location: ${view.location}`, width),
        ]),
  ];
}
