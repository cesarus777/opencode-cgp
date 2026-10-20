import { Rpc } from "@opencode/plugin/rpc";
import type {
  SnapshotBatch,
  SnapshotRead,
  SnapshotReadResult,
} from "./snapshot.ts";
const count = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const text = { type: "string", minLength: 1, maxLength: 512 } as const;
const enumeration = (...values: string[]) => ({ type: "string", enum: values });
const object = (
  properties: Record<string, object>,
  required = Object.keys(properties),
) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const array = (items: object, maxItems = 128) => ({
  type: "array",
  items,
  maxItems,
});
const measurement = object(
  {
    tokens: count,
    at: count,
    model: text,
    requestId: text,
    provenance: enumeration("provider-normalized", "serialized-estimate"),
    confidence: enumeration("reported", "approximate"),
    scope: enumeration("completed-request", "prepared-request"),
  },
  ["tokens", "at", "model", "provenance", "confidence", "scope"],
);
const row = object(
  {
    sessionId: text,
    revision: count,
    observedAt: count,
    parentId: text,
    agent: text,
    model: text,
    measurement,
    limits: object({ context: count, input: count, output: count }, [
      "context",
      "output",
    ]),
    capacityTokens: count,
    outputReserveTokens: count,
    peakTokens: count,
    policy: object(
      {
        id: text,
        configured: object({
          type: enumeration("tokens", "ratio", "remaining"),
          value: { type: "number", minimum: 0 },
        }),
        triggerTokens: { type: "number" },
        comparison: enumeration(">=", ">"),
        reason: enumeration(
          "missing-usage",
          "model-changed",
          "invalid-usage",
          "stale-usage",
          "missing-model-budget",
          "incompatible-model-budget",
          "threshold-crossed",
          "below-threshold",
        ),
        crossed: { type: "boolean" },
      },
      ["id", "configured", "comparison", "reason", "crossed"],
    ),
    compaction: object(
      {
        phase: enumeration(
          "idle",
          "requesting",
          "accepted",
          "running",
          "awaiting-measurement",
          "blocked",
          "uncertain",
        ),
        count,
        armed: { type: "boolean" },
        blockedReason: enumeration(
          "session-removed",
          "compaction-failed",
          "reclaim-unverifiable",
          "insufficient-reclaim",
          "completion-event-timeout",
          "admission-outcome-unknown",
          "restart-needs-lifecycle-evidence",
        ),
        lastAttempt: count,
        lastCompleted: count,
        cooldownUntil: count,
      },
      ["phase", "armed"],
    ),
    cumulative: object({
      input: count,
      output: count,
      reasoning: count,
      cache: object({ read: count, write: count }),
    }),
    cumulativeScope: enumeration("session", "unknown"),
    lastObservedActive: { type: "boolean" },
  },
  [
    "sessionId",
    "revision",
    "observedAt",
    "policy",
    "compaction",
    "cumulativeScope",
    "lastObservedActive",
  ],
);
const batchFields = {
  schemaVersion: { const: 1 },
  epoch: text,
  sequence: count,
  generatedAt: count,
  health: object({
    enabled: { type: "boolean" },
    mode: enumeration("observe", "enforce"),
    enforcement: enumeration("observing", "available", "suspended", "disabled"),
    reasons: array(
      enumeration(
        "event-stream-gap",
        "persistence-unavailable",
        "capacity-exceeded",
        "model-metadata-unavailable",
      ),
      8,
    ),
    staleMs: count,
    maxSessions: count,
  }),
  upserts: array(row),
  removed: array(
    object({
      sessionId: text,
      revision: count,
      reason: enumeration("deleted", "evicted"),
    }),
  ),
};
export const readSchema = object({
  schemaVersion: { const: 1 },
  sessionIds: { ...array(text), uniqueItems: true },
});
export const batchSchema = object(batchFields);
export const resultSchema = object({
  ...batchFields,
  unavailable: array(
    object({ sessionId: text, reason: enumeration("not-monitored") }),
  ),
});
export const monitorRpc = Rpc.define({
  id: "context-guard.monitor.v1",
  methods: { read: { input: readSchema, output: resultSchema } },
  events: { changed: { schema: batchSchema } },
});
const nonnegative = { type: "number", minimum: 0 } as const;
export const performanceSchema = object(
  {
    observedSince: count,
    at: count,
    sessionCreatedAt: count,
    sessionOutputTokens: count,
    status: enumeration("waiting", "streaming", "idle", "unavailable"),
    partial: { type: "boolean" },
    liveTps: nonnegative,
    averageModelTps: nonnegative,
    averageSessionTps: nonnegative,
    ttftMs: nonnegative,
    latestRequestTps: nonnegative,
    requestId: text,
    requestAgent: text,
    requestModel: text,
    requestOutputTokens: count,
    requestStartedAt: count,
    firstOutputAt: count,
    streamEndedAt: count,
    estimatedOutputTokens: nonnegative,
    modelOutputTokens: nonnegative,
    modelDurationMs: nonnegative,
    completedRequests: count,
    tokenSource: enumeration("estimated", "reported", "unavailable"),
  },
  [
    "sessionCreatedAt",
    "observedSince",
    "at",
    "status",
    "partial",
    "estimatedOutputTokens",
    "modelOutputTokens",
    "modelDurationMs",
    "completedRequests",
    "tokenSource",
  ],
);
// The batch envelope remains version 1; the distinct RPC ID versions its row contract.
const performanceRow = {
  ...row,
  properties: { ...row.properties, performance: performanceSchema },
};
export const performanceBatchSchema = object({
  ...batchFields,
  upserts: array(performanceRow),
});
export const performanceResultSchema = object({
  ...batchFields,
  upserts: array(performanceRow),
  unavailable: resultSchema.properties.unavailable ?? {},
});
export const performanceRpc = Rpc.define({
  id: "context-guard.monitor.v2",
  methods: { read: { input: readSchema, output: performanceResultSchema } },
  events: { changed: { schema: performanceBatchSchema } },
});
export function isPerformanceBatch(value: unknown): value is SnapshotBatch {
  return valid(value, performanceBatchSchema) && uniqueRows(value);
}
export function isPerformanceResult(
  value: unknown,
): value is SnapshotReadResult {
  return valid(value, performanceResultSchema) && uniqueRows(value);
}
export function isPerformanceSnapshot(
  value: unknown,
): value is import("./performance.ts").PerformanceSnapshot {
  return valid(value, performanceSchema);
}
const chartPointSchema = object(
  {
    time: count,
    agent: text,
    model: text,
    breakBefore: { type: "boolean" },
    partial: { type: "boolean" },
    liveTps: nonnegative,
    averageModelTps: nonnegative,
    averageSessionTps: nonnegative,
    sessionOutputTokens: count,
  },
  ["time", "breakBefore", "partial"],
);
const chartRequestSchema = object(
  {
    time: count,
    requestId: text,
    started: count,
    agent: text,
    model: text,
    ttftMs: nonnegative,
    outputTokens: count,
    durationMs: nonnegative,
    tps: nonnegative,
    partial: { type: "boolean" },
  },
  ["time", "requestId", "started", "partial"],
);
export const historyReadSchema = object({
  schemaVersion: { const: 1 },
  sessionId: text,
  from: count,
  to: count,
  maxPoints: { type: "integer", minimum: 16, maximum: 500 },
});
const historyResultSchema = object({
  schemaVersion: { const: 1 },
  generatedAt: count,
  enabled: { type: "boolean" },
  truncated: { type: "boolean" },
  metadata: object(
    {
      schema: { const: 1 },
      retainedFrom: count,
      retainedBytes: count,
      skippedBytes: count,
      malformedRecords: count,
      completeness: enumeration("bounded-retention"),
    },
    [
      "schema",
      "retainedBytes",
      "skippedBytes",
      "malformedRecords",
      "completeness",
    ],
  ),
  data: object(
    {
      schema: { const: 1 },
      omittedSessions: count,
      omittedGaps: count,
      maxPoints: count,
      gaps: array(object({ time: count, sessionId: text, reason: text }), 128),
      series: array(
        object(
          {
            sessionId: text,
            parentId: text,
            agents: array(text, 1024),
            models: array(text, 1024),
            points: array(chartPointSchema, 500),
            requests: array(chartRequestSchema, 500),
            originalPoints: count,
          },
          [
            "sessionId",
            "agents",
            "models",
            "points",
            "requests",
            "originalPoints",
          ],
        ),
        1,
      ),
    },
    ["schema", "omittedSessions", "maxPoints", "gaps", "series"],
  ),
});
export const historyRpc = Rpc.define({
  id: "context-guard.history.v1",
  methods: { read: { input: historyReadSchema, output: historyResultSchema } },
  events: {},
});
export function isHistoryRead(
  value: unknown,
): value is import("./historycharts.ts").HistoryChartRead {
  return (
    valid(value, historyReadSchema) &&
    record(value) &&
    typeof value.from === "number" &&
    typeof value.to === "number" &&
    value.from <= value.to &&
    value.to - value.from <= 7 * 86400000
  );
}
export function isHistoryResult(
  value: unknown,
): value is import("./historycharts.ts").HistoryChartResult {
  return valid(value, historyResultSchema);
}
function record(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function matches(value: unknown, schema: unknown): boolean {
  if (!record(schema)) return false;
  if ("const" in schema && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.type === "number" || schema.type === "integer")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (schema.type !== "integer" || Number.isSafeInteger(value)) &&
      (typeof schema.minimum !== "number" || value >= schema.minimum) &&
      (typeof schema.maximum !== "number" || value <= schema.maximum)
    );
  if (schema.type === "string")
    return typeof value === "string" && value.length > 0 && value.length <= 512;
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length <= Number(schema.maxItems) &&
      (!schema.uniqueItems || new Set(value).size === value.length) &&
      value.every((v) => matches(v, schema.items))
    );
  if (schema.type === "object") {
    if (
      !record(value) ||
      !record(schema.properties) ||
      !Array.isArray(schema.required)
    )
      return false;
    const properties = schema.properties;
    return (
      schema.required.every((k) => typeof k === "string" && k in value) &&
      Object.keys(value).every(
        (k) => k in properties && matches(value[k], properties[k]),
      )
    );
  }
  return "const" in schema;
}
function valid(value: unknown, schema: object) {
  try {
    return JSON.stringify(value).length <= 524288 && matches(value, schema);
  } catch {
    return false;
  }
}
export function isRead(value: unknown): value is SnapshotRead {
  return valid(value, readSchema);
}
export function isBatch(value: unknown): value is SnapshotBatch {
  return valid(value, batchSchema) && uniqueRows(value);
}
export function isResult(value: unknown): value is SnapshotReadResult {
  return valid(value, resultSchema) && uniqueRows(value);
}
function uniqueRows(value: unknown) {
  if (
    !record(value) ||
    !Array.isArray(value.upserts) ||
    !Array.isArray(value.removed)
  )
    return false;
  const ids = [...value.upserts, ...value.removed].map((v) =>
    record(v) ? v.sessionId : undefined,
  );
  return ids.length <= 128 && new Set(ids).size === ids.length;
}
