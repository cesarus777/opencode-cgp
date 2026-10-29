import type { GuardRow } from "../family.ts";
import type { MonitorHealth } from "../snapshot.ts";
import type { HistoryChartResult } from "../historycharts.ts";
import type { Connection } from "../tui/transport.ts";
import type { InventoryNotice } from "./inventory.ts";
import type { DashboardModels } from "./models.ts";

export type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;
export const historyWindows = [300000, 3600000, 86400000, 604800000] as const;
export type HistoryWindow = (typeof historyWindows)[number];
export type DashboardScreen = "overview" | "detail" | "history" | "models";
export interface DashboardFilters {
  readonly search: string;
  readonly agent: string;
  readonly model: string;
}
export interface DashboardRow extends GuardRow {
  readonly inventoryStale: boolean;
  readonly liveStale: boolean;
  readonly measurementAgeMs?: number;
  readonly performanceAvailable: boolean;
  readonly performanceFreshness: "fresh" | "stale" | "missing" | "invalid";
}
export interface HistorySummary {
  readonly source: "matched-request-records";
  readonly observedRequests: number;
  readonly matchedRequests: number;
  readonly partial: boolean;
  readonly outputTokens?: number;
  readonly durationMs?: number;
  readonly averageModelTps?: number;
}
export interface DashboardHistory {
  readonly status: "idle" | "loading" | "ready" | "disabled" | "unavailable";
  readonly windowMs: HistoryWindow;
  readonly maxWindowMs: 604800000;
  readonly maxPoints: 500;
  readonly sessionId?: string;
  readonly from?: number;
  readonly to?: number;
  readonly stale: boolean;
  readonly notices: readonly string[];
  readonly result?: Immutable<HistoryChartResult>;
  readonly summary?: HistorySummary;
}
export type DashboardView = Immutable<{
  schemaVersion: 1;
  generatedAt: number;
  running: boolean;
  location: string;
  locations: readonly string[];
  screen: DashboardScreen;
  filters: DashboardFilters;
  connection: Connection;
  monitorVersion?: 1 | 2;
  health?: MonitorHealth;
  inventory: {
    refreshing: boolean;
    complete: boolean;
    stale: boolean;
    pages: number;
    total: number;
    visible: number;
    monitored: number;
    active: number;
    maxNodes: number;
    maxPages: number;
    maxDepth: number;
    notices: readonly InventoryNotice[];
  };
  rows: readonly DashboardRow[];
  selectedSessionId?: string;
  selected?: DashboardRow;
  history: DashboardHistory;
  models: DashboardModels;
  notices: readonly string[];
}>;

/** Clone before freezing so transport-owned objects never become UI-owned state. */
export function immutableView<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object") return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

export function projectHistory(
  result: HistoryChartResult,
  filters: DashboardFilters,
): { result: HistoryChartResult; summary: HistorySummary; notices: string[] } {
  const match = (point: { agent?: string; model?: string }) =>
    (!filters.agent || point.agent === filters.agent) &&
    (!filters.model || point.model === filters.model);
  const series = result.data.series.map((series) => {
    let gap = false;
    const points = series.points.flatMap((point) => {
      gap ||= point.breakBefore;
      if (!match(point)) return [];
      const next = { ...point, breakBefore: gap };
      gap = false;
      return [next];
    });
    return { ...series, points, requests: series.requests.filter(match) };
  });
  const requests = series.flatMap((series) => series.requests);
  const matched = requests.filter(
    (request) =>
      request.outputTokens !== undefined &&
      request.durationMs !== undefined &&
      request.durationMs > 0,
  );
  const output = matched.reduce(
    (sum, request) => sum + (request.outputTokens ?? 0),
    0,
  );
  const duration = matched.reduce(
    (sum, request) => sum + (request.durationMs ?? 0),
    0,
  );
  const partial =
    result.truncated ||
    result.metadata.skippedBytes > 0 ||
    result.metadata.malformedRecords > 0 ||
    result.data.omittedSessions > 0 ||
    requests.some((request) => request.partial) ||
    matched.length !== requests.length ||
    result.data.gaps.length > 0 ||
    (result.data.omittedGaps ?? 0) > 0;
  const notices = [
    "bounded-retention",
    "maximum-seven-days",
    "maximum-500-points-and-requests",
  ];
  if (!result.enabled) notices.push("history-disabled");
  if (
    result.truncated ||
    result.metadata.skippedBytes ||
    result.metadata.malformedRecords ||
    result.data.omittedSessions
  )
    notices.push("partial-history");
  if (
    result.data.gaps.length ||
    result.data.omittedGaps ||
    result.data.series.some((series) =>
      series.points.some((point) => point.breakBefore),
    )
  )
    notices.push("history-gaps");
  if (
    result.data.series.some(
      (series) => series.originalPoints > series.points.length,
    )
  )
    notices.push("downsampled-history");
  if (
    result.data.series.some((series) =>
      series.points.some((point) => point.partial),
    ) ||
    requests.some((request) => request.partial)
  )
    notices.push("partial-measurements");
  return {
    result: { ...result, data: { ...result.data, series } },
    summary: {
      source: "matched-request-records",
      observedRequests: requests.length,
      matchedRequests: matched.length,
      partial,
      ...(matched.length
        ? {
            outputTokens: output,
            durationMs: duration,
            averageModelTps: (output * 1000) / duration,
          }
        : {}),
    },
    notices,
  };
}
