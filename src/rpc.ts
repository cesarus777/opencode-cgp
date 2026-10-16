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
