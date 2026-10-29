import type { HistoryRecord } from "./history.ts";

export interface ModelAnalyticsOptions {
  /** Caller-owned location identity; never inferred from archive contents. */
  location: string;
  model?: string;
  agent?: string;
  from?: number;
  to?: number;
  maxRequests?: number;
}

export interface AnalyticsRequest {
  location: string;
  sessionId: string;
  requestId: string;
  startedAt: number;
  completedAt?: number;
  model?: string;
  agent?: string;
  attribution: "request" | "legacy-record" | "unknown";
  partial: boolean;
  outputTokens?: number;
  ttftMs?: number;
}

export interface ModelSummary {
  model?: string;
  sessions: number;
  completedRequests: number;
  partialRequests: number;
  legacyAttributionRequests: number;
  tpsRequests: number;
  ttftRequests: number;
  excludedTpsRequests: number;
  excludedTtftRequests: number;
  outputTokens: number;
  durationMs: number;
  averageTps?: number;
  meanTtftMs?: number;
  medianTtftMs?: number;
  p95TtftMs?: number;
}

export interface ModelAnalyticsResult {
  schemaVersion: 1;
  location: string;
  models: ModelSummary[];
  coverage: {
    source: "retained-request-records";
    scannedRecords: number;
    unscannedRecords: number;
    duplicateRecords: number;
    conflictingRequests: number;
    missingIdentityRecords: number;
    incompleteRequests: number;
    invalidTimingRequests: number;
    gapRecords: number;
    maxRequests: number;
    partial: boolean;
  };
}

const nonnegative = (n: number | undefined): n is number =>
  n !== undefined && Number.isFinite(n) && n >= 0;

/** Project only completed-request facts; never use session totals or live estimates. */
function requestFact(record: HistoryRecord): AnalyticsRequest | undefined {
  const p = record.performance;
  if (!p?.requestId || !record.sessionId || !nonnegative(p.requestStartedAt))
    return;
  const model = p.requestModel || record.model;
  const agent = p.requestAgent || record.agent;
  const ttft =
    p.ttftMs ??
    (p.firstOutputAt === undefined
      ? undefined
      : p.firstOutputAt - p.requestStartedAt);
  return {
    location: "",
    sessionId: record.sessionId,
    requestId: p.requestId,
    startedAt: p.requestStartedAt,
    ...(p.streamEndedAt === undefined ? {} : { completedAt: p.streamEndedAt }),
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
    attribution: p.requestModel
      ? "request"
      : model
        ? "legacy-record"
        : "unknown",
    partial: p.partial,
    ...(p.tokenSource === "reported" && nonnegative(p.requestOutputTokens)
      ? { outputTokens: p.requestOutputTokens }
      : {}),
    ...(ttft === undefined ? {} : { ttftMs: ttft }),
  };
}

/** Complementary observations may enrich facts; contradictory facts never get averaged. */
function reconcile(
  a: AnalyticsRequest,
  b: AnalyticsRequest,
): AnalyticsRequest | undefined {
  for (const field of [
    "completedAt",
    "outputTokens",
    "ttftMs",
    "agent",
  ] as const)
    if (
      a[field] !== undefined &&
      b[field] !== undefined &&
      a[field] !== b[field]
    )
      return;
  if (a.model && b.model && a.model !== b.model) return;
  const rank = { unknown: 0, "legacy-record": 1, request: 2 };
  const preferred = rank[b.attribution] > rank[a.attribution] ? b : a;
  return {
    ...a,
    ...b,
    ...(preferred.model ? { model: preferred.model } : {}),
    attribution: preferred.attribution,
    partial: a.partial || b.partial,
  };
}

/** Aggregate raw request records before any chart downsampling or session limits. */
export function analyzeModelRequests(
  records: readonly HistoryRecord[],
  options: ModelAnalyticsOptions,
): ModelAnalyticsResult & { requests: CompletedAnalyticsRequest[] } {
  const maxRequests = options.maxRequests ?? 100000;
  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 1000000
  )
    throw new Error("maxRequests must be an integer from 1 to 1000000");
  if (!options.location)
    throw new Error("Analytics requires a location identity");
  for (const value of [options.from, options.to])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      throw new Error("Invalid analytics timestamp");
  if (
    options.from !== undefined &&
    options.to !== undefined &&
    options.from > options.to
  )
    throw new Error("--from must precede --to");
  const coverage: ModelAnalyticsResult["coverage"] = {
    source: "retained-request-records",
    scannedRecords: 0,
    unscannedRecords: 0,
    duplicateRecords: 0,
    conflictingRequests: 0,
    missingIdentityRecords: 0,
    incompleteRequests: 0,
    invalidTimingRequests: 0,
    gapRecords: 0,
    maxRequests,
    partial: false,
  };
  const requests = new Map<
    string,
    { fact: AnalyticsRequest; conflict: boolean }
  >();
  for (const record of records) {
    coverage.scannedRecords++;
    if (record.type === "gap") {
      coverage.gapRecords++;
      continue;
    }
    if (record.type !== "request") continue;
    const fact = requestFact(record);
    if (!fact) {
      coverage.missingIdentityRecords++;
      continue;
    }
    fact.location = options.location;
    const key = JSON.stringify([
      fact.sessionId,
      fact.requestId,
      fact.startedAt,
    ]);
    const previous = requests.get(key);
    if (previous) {
      coverage.duplicateRecords++;
      const merged = reconcile(previous.fact, fact);
      if (!merged) previous.conflict = true;
      else previous.fact = merged;
    } else {
      if (requests.size === maxRequests) {
        coverage.scannedRecords--;
        coverage.unscannedRecords = records.length - coverage.scannedRecords;
        break;
      }
      requests.set(key, { fact, conflict: false });
    }
  }
  const accepted: CompletedAnalyticsRequest[] = [];
  for (const { fact: r, conflict } of requests.values()) {
    if (conflict) {
      coverage.conflictingRequests++;
      continue;
    }
    if (r.completedAt === undefined) {
      coverage.incompleteRequests++;
      continue;
    }
    const duration = r.completedAt - r.startedAt;
    if (
      !nonnegative(r.completedAt) ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      coverage.invalidTimingRequests++;
      continue;
    }
    if (
      (options.from !== undefined && r.completedAt < options.from) ||
      (options.to !== undefined && r.completedAt >= options.to) ||
      (options.model !== undefined && r.model !== options.model) ||
      (options.agent !== undefined && r.agent !== options.agent)
    )
      continue;
    accepted.push({ ...r, completedAt: r.completedAt });
  }
  const models = summarizeModelRequests(accepted);
  coverage.partial =
    coverage.unscannedRecords > 0 ||
    coverage.conflictingRequests > 0 ||
    coverage.missingIdentityRecords > 0 ||
    coverage.incompleteRequests > 0 ||
    coverage.invalidTimingRequests > 0 ||
    coverage.gapRecords > 0 ||
    models.some(
      (s) =>
        s.partialRequests > 0 ||
        s.legacyAttributionRequests > 0 ||
        s.excludedTpsRequests > 0 ||
        s.excludedTtftRequests > 0 ||
        !s.model,
    );
  return {
    schemaVersion: 1,
    location: options.location,
    models,
    coverage,
    requests: accepted,
  };
}

export interface CompletedAnalyticsRequest extends AnalyticsRequest {
  completedAt: number;
}

/** Summarize already reconciled requests, including independent metric eligibility. */
export function summarizeModelRequests(
  requests: readonly CompletedAnalyticsRequest[],
): ModelSummary[] {
  const groups = new Map<
    string | undefined,
    {
      summary: ModelSummary;
      sessions: Set<string>;
      ttfts: number[];
    }
  >();
  for (const r of requests) {
    const duration = r.completedAt - r.startedAt;
    let group = groups.get(r.model);
    if (!group) {
      group = {
        summary: {
          ...(r.model ? { model: r.model } : {}),
          sessions: 0,
          completedRequests: 0,
          partialRequests: 0,
          legacyAttributionRequests: 0,
          tpsRequests: 0,
          ttftRequests: 0,
          excludedTpsRequests: 0,
          excludedTtftRequests: 0,
          outputTokens: 0,
          durationMs: 0,
        },
        sessions: new Set(),
        ttfts: [],
      };
      groups.set(r.model, group);
    }
    const s = group.summary;
    group.sessions.add(r.sessionId);
    s.completedRequests++;
    if (r.partial) s.partialRequests++;
    if (r.attribution === "legacy-record") s.legacyAttributionRequests++;
    if (r.outputTokens !== undefined) {
      s.tpsRequests++;
      s.outputTokens += r.outputTokens;
      s.durationMs += duration;
    } else s.excludedTpsRequests++;
    if (nonnegative(r.ttftMs) && r.ttftMs <= duration)
      group.ttfts.push(r.ttftMs);
    else s.excludedTtftRequests++;
  }
  const models = [...groups.values()]
    .map(({ summary: s, sessions, ttfts }) => {
      s.sessions = sessions.size;
      s.ttftRequests = ttfts.length;
      if (s.tpsRequests) s.averageTps = (s.outputTokens * 1000) / s.durationMs;
      ttfts.sort((a, b) => a - b);
      if (ttfts.length) {
        s.meanTtftMs = ttfts.reduce((sum, n) => sum + n, 0) / ttfts.length;
        s.medianTtftMs =
          ((ttfts[Math.floor((ttfts.length - 1) / 2)] ?? 0) +
            (ttfts[Math.floor(ttfts.length / 2)] ?? 0)) /
          2;
        const p95 = ttfts[Math.ceil(ttfts.length * 0.95) - 1];
        if (p95 !== undefined) s.p95TtftMs = p95;
      }
      return s;
    })
    .sort((a, b) => (a.model ?? "").localeCompare(b.model ?? ""));
  return models;
}

export function aggregateModels(
  records: readonly HistoryRecord[],
  options: ModelAnalyticsOptions,
): ModelAnalyticsResult {
  const { requests: _requests, ...result } = analyzeModelRequests(
    records,
    options,
  );
  return result;
}
