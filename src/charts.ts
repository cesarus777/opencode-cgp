import type { HistoryRecord } from "./history.ts";

export interface ChartPoint {
  time: number;
  agent?: string;
  model?: string;
  breakBefore: boolean;
  partial: boolean;
  liveTps?: number;
  averageModelTps?: number;
  averageSessionTps?: number;
  sessionOutputTokens?: number;
}
export interface ChartRequest {
  time: number;
  requestId: string;
  started: number;
  agent?: string;
  model?: string;
  ttftMs?: number;
  outputTokens?: number;
  durationMs?: number;
  tps?: number;
  partial: boolean;
}
export interface ChartSeries {
  sessionId: string;
  parentId?: string;
  agents: string[];
  models: string[];
  points: ChartPoint[];
  requests: ChartRequest[];
  originalPoints: number;
}
export interface ChartGap {
  time: number;
  sessionId: string;
  reason: string;
}
export interface ChartData {
  schema: 1;
  series: ChartSeries[];
  gaps: ChartGap[];
  omittedSessions: number;
  omittedGaps?: number;
  maxPoints: number;
}
export interface ChartOptions {
  sessionId?: string;
  maxPoints?: number;
  maxSessions?: number;
}
const rateFields = [
  "liveTps",
  "averageModelTps",
  "averageSessionTps",
  "sessionOutputTokens",
] as const;

/** Preserve actual timestamps and extrema; never average a bucket's rates or bridge a gap. */
export function downsamplePoints(
  points: readonly ChartPoint[],
  limit: number,
): ChartPoint[] {
  if (!Number.isSafeInteger(limit) || limit < 16 || limit > 5000)
    throw new Error("maxPoints must be an integer from 16 to 5000");
  if (points.length <= limit) return [...points];
  // Select endpoints and metric extrema in each chronological bucket. A skipped
  // discontinuity is propagated onto the next selected point.
  const buckets = Math.max(1, Math.floor(limit / (2 + rateFields.length * 2)));
  const selected = new Set<number>();
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * points.length) / buckets),
      end = Math.floor(((b + 1) * points.length) / buckets);
    selected.add(start);
    selected.add(end - 1);
    for (const field of rateFields) {
      let low: number | undefined, high: number | undefined;
      for (let i = start; i < end; i++) {
        const value = points[i]?.[field];
        if (value === undefined) continue;
        if (low === undefined || value < (points[low]?.[field] ?? Infinity))
          low = i;
        if (high === undefined || value > (points[high]?.[field] ?? -Infinity))
          high = i;
      }
      if (low !== undefined) selected.add(low);
      if (high !== undefined) selected.add(high);
    }
  }
  let previous = -1;
  return [...selected]
    .sort((a, b) => a - b)
    .flatMap((index) => {
      const point = points[index];
      if (!point) return [];
      const skippedGap = points
        .slice(previous + 1, index + 1)
        .some((p) => p.breakBefore);
      previous = index;
      return [{ ...point, breakBefore: point.breakBefore || skippedGap }];
    });
}

export function buildChartData(
  records: readonly HistoryRecord[],
  options: ChartOptions = {},
): ChartData {
  const maxPoints = options.maxPoints ?? 1000,
    maxSessions = options.maxSessions ?? 128;
  if (
    !Number.isSafeInteger(maxSessions) ||
    maxSessions < 1 ||
    maxSessions > 1024
  )
    throw new Error("maxSessions must be from 1 to 1024");
  downsamplePoints([], maxPoints); // Validate even for an empty archive.
  const sorted = [...records].sort(
    (a, b) => a.time - b.time || a.recordId.localeCompare(b.recordId),
  );
  const lastSeen = new Map<string, number>();
  for (const r of sorted)
    if (
      r.performance &&
      (!options.sessionId || r.sessionId === options.sessionId)
    )
      lastSeen.set(r.sessionId, r.time);
  const sessions = [...lastSeen].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const selected = new Set(sessions.slice(0, maxSessions).map(([id]) => id));
  const series = new Map<string, ChartSeries>(),
    gaps: ChartGap[] = [];
  const seen = new Set<string>(),
    requestSeen = new Set<string>();
  const pendingGaps = new Set<string>();
  const observedSince = new Map<string, number>();
  for (const r of sorted) {
    if (seen.has(r.recordId)) continue;
    seen.add(r.recordId);
    if (r.type === "gap") {
      if (r.sessionId === "__history__" || selected.has(r.sessionId)) {
        gaps.push({
          time: r.time,
          sessionId: r.sessionId,
          reason: r.event ?? "observation-gap",
        });
        if (r.sessionId === "__history__")
          for (const id of selected) pendingGaps.add(id);
        else pendingGaps.add(r.sessionId);
      }
      continue;
    }
    const p = r.performance;
    if (!p || !selected.has(r.sessionId)) continue;
    let s = series.get(r.sessionId);
    if (!s) {
      s = {
        sessionId: r.sessionId,
        ...(r.parentId ? { parentId: r.parentId } : {}),
        agents: [],
        models: [],
        points: [],
        requests: [],
        originalPoints: 0,
      };
      series.set(r.sessionId, s);
    }
    const agent = p.requestAgent ?? r.agent,
      model = p.requestModel ?? r.model;
    if (agent && !s.agents.includes(agent)) s.agents.push(agent);
    if (model && !s.models.includes(model)) s.models.push(model);
    const previous = s.points.at(-1);
    const restart =
      observedSince.has(r.sessionId) &&
      observedSince.get(r.sessionId) !== p.observedSince;
    const reset =
      previous?.sessionOutputTokens !== undefined &&
      p.sessionOutputTokens !== undefined &&
      p.sessionOutputTokens < previous.sessionOutputTokens;
    const discontinuity =
      pendingGaps.has(r.sessionId) ||
      restart ||
      reset ||
      !previous ||
      previous.partial !== p.partial ||
      previous.liveTps === undefined ||
      p.liveTps === undefined ||
      r.time - previous.time > 2500 ||
      previous.agent !== agent ||
      previous.model !== model;
    const point: ChartPoint = {
      time: r.time,
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
      breakBefore: discontinuity,
      partial: p.partial,
      ...(p.liveTps === undefined ? {} : { liveTps: p.liveTps }),
      ...(p.averageModelTps === undefined
        ? {}
        : { averageModelTps: p.averageModelTps }),
      ...(p.averageSessionTps === undefined
        ? {}
        : { averageSessionTps: p.averageSessionTps }),
      ...(p.sessionOutputTokens === undefined
        ? {}
        : { sessionOutputTokens: p.sessionOutputTokens }),
    };
    // Snapshots can be emitted by both the timer and a lifecycle event at one timestamp.
    if (previous?.time === point.time)
      s.points[s.points.length - 1] = {
        ...point,
        breakBefore: point.breakBefore || previous.breakBefore,
      };
    else s.points.push(point);
    observedSince.set(r.sessionId, p.observedSince);
    pendingGaps.delete(r.sessionId);
    if (
      r.type === "request" &&
      p.requestId !== undefined &&
      p.requestStartedAt !== undefined
    ) {
      const key = JSON.stringify([
        r.sessionId,
        p.requestId,
        p.requestStartedAt,
      ]);
      if (requestSeen.has(key)) continue;
      requestSeen.add(key);
      const duration =
        p.streamEndedAt === undefined
          ? undefined
          : p.streamEndedAt - p.requestStartedAt;
      const validDuration = duration !== undefined && duration > 0;
      const output =
        p.tokenSource === "reported" ? p.requestOutputTokens : undefined;
      s.requests.push({
        time: r.time,
        requestId: p.requestId,
        started: p.requestStartedAt,
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
        partial: p.partial,
        ...(p.ttftMs === undefined ? {} : { ttftMs: p.ttftMs }),
        ...(output === undefined ? {} : { outputTokens: output }),
        ...(validDuration ? { durationMs: duration } : {}),
        ...(output !== undefined && validDuration
          ? { tps: (output * 1000) / duration }
          : {}),
      });
    }
  }
  return {
    schema: 1,
    series: [...series.values()].map((s) => ({
      ...s,
      originalPoints: s.points.length,
      points: downsamplePoints(s.points, maxPoints),
    })),
    gaps: gaps.slice(-1024),
    omittedGaps: Math.max(0, gaps.length - 1024),
    omittedSessions: Math.max(0, sessions.length - selected.size),
    maxPoints,
  };
}
