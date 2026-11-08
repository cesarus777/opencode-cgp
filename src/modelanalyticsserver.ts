import type {
  RpcHandlers,
  RpcRegistration,
} from "@opencode/plugin/promise/rpc";
import { createHash } from "node:crypto";
import {
  readPerformanceHistory,
  scanScheduler,
  type HistoryRecord,
} from "./history.ts";
import {
  analyzeModelRequests,
  createModelAccumulator,
  summarizeModelRequestSteps,
  type CompletedAnalyticsRequest,
  type ModelSummary,
} from "./modelanalytics.ts";
import {
  bucketModelRequests,
  type AnalyticsRead,
  type AnalyticsResult,
} from "./modelseries.ts";
import { analyticsRpc, isAnalyticsRead, isAnalyticsResult } from "./rpc.ts";

export interface AnalyticsRpcPort {
  register(
    definition: typeof analyticsRpc,
    handlers: RpcHandlers<typeof analyticsRpc>,
  ): Promise<Pick<RpcRegistration<typeof analyticsRpc>, "dispose">>;
}
type Archive = Awaited<ReturnType<typeof readPerformanceHistory>> & {
  iterateRecords?: () => Iterable<HistoryRecord>;
};
type Analysis = ReturnType<typeof analyzeModelRequests>;
interface Snapshot {
  id: string;
  key: string;
  generatedAt: number;
  expiresAt: number;
  requests: CompletedAnalyticsRequest[];
  models: ModelSummary[];
  coverage: Analysis["coverage"];
  metadata: Archive["metadata"];
  gaps: number[];
  omittedGaps: number;
  revision?: string;
  sorted: Map<string, ModelSummary[]>;
  variants: Map<
    string,
    {
      requests: CompletedAnalyticsRequest[];
      buckets: AnalyticsResult["buckets"];
    }
  >;
}
const metadata: Archive["metadata"] = {
  schema: 1,
  retainedBytes: 0,
  skippedBytes: 0,
  malformedRecords: 0,
  completeness: "bounded-retention",
};

async function responsive<T>(
  steps: Generator<void, T>,
  signal: AbortSignal,
): Promise<T> {
  const checkpoint = scanScheduler(signal);
  let step = steps.next(),
    iterations = 0;
  while (!step.done) {
    if (++iterations % 64 === 0) {
      const waiting = checkpoint();
      if (waiting) await waiting;
    }
    step = steps.next();
  }
  signal.throwIfAborted();
  return step.value;
}
function* collectRecords(
  values: Iterable<HistoryRecord>,
): Generator<void, HistoryRecord[]> {
  const records: HistoryRecord[] = [];
  for (const record of values) {
    yield;
    records.push(record);
  }
  return records;
}
function* sortRequests(
  requests: CompletedAnalyticsRequest[],
): Generator<void, CompletedAnalyticsRequest[]> {
  const compare = (
    a: CompletedAnalyticsRequest,
    b: CompletedAnalyticsRequest,
  ) =>
    b.completedAt - a.completedAt ||
    a.sessionId.localeCompare(b.sessionId) ||
    a.requestId.localeCompare(b.requestId) ||
    a.startedAt - b.startedAt;
  let source = requests,
    target = requests.slice();
  for (let size = 1; size < requests.length; size *= 2) {
    for (let start = 0; start < requests.length; start += 2 * size) {
      const middle = Math.min(start + size, requests.length),
        end = Math.min(start + 2 * size, requests.length);
      let left = start,
        right = middle;
      for (let output = start; output < end; output++) {
        yield;
        const a = source[left],
          b = source[right];
        if (left < middle && a && (right >= end || !b || compare(a, b) <= 0)) {
          target[output] = a;
          left++;
        } else if (b) {
          target[output] = b;
          right++;
        }
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

/** One instance owns exactly one server-selected location/archive; no client paths. */
export function createAnalyticsService(
  path: string,
  location: string,
  enabled: boolean,
  options: {
    now?: () => number;
    read?: typeof readPerformanceHistory;
    revisioned?: boolean;
  } = {},
) {
  const now = options.now ?? Date.now;
  const reader = options.read ?? readPerformanceHistory;
  const snapshots = new Map<string, Snapshot>();
  const shutdown = new AbortController();
  let stopped = false,
    projecting = 0;
  let archive:
    | { at: number; source: Archive; analysis: Analysis; revision?: string }
    | undefined;
  type Scan = {
    promise: Promise<NonNullable<typeof archive>>;
    controller: AbortController;
    waiters: number;
  };
  let scan: Scan | undefined;
  let incremental:
    | {
        prefix: readonly HistoryRecord[];
        accumulator: ReturnType<typeof createModelAccumulator>;
      }
    | undefined;
  async function load(signal: AbortSignal) {
    if (archive && !options.revisioned && now() - archive.at < 30000)
      return archive;
    if (!scan || scan.controller.signal.aborted) {
      const controller = new AbortController();
      const job: Scan = {
        controller,
        waiters: 0,
        promise: Promise.resolve()
          .then(async () => {
            const source: Archive = enabled
              ? await reader(path, { signal: controller.signal })
              : { metadata, records: [] };
            controller.signal.throwIfAborted();
            if (stopped) throw new Error("Analytics service stopped");
            const revision =
              "revision" in source && typeof source.revision === "string"
                ? source.revision
                : undefined;
            if (
              archive &&
              revision !== undefined &&
              archive.revision === revision
            ) {
              archive = { ...archive, at: now() };
              return archive;
            }
            const records = source.iterateRecords
              ? await responsive(
                  collectRecords(source.iterateRecords()),
                  controller.signal,
                )
              : source.records;
            const previous = incremental;
            incremental = undefined;
            const append =
              previous &&
              records.length >= previous.prefix.length &&
              previous.prefix.every(
                (record, index) => records[index] === record,
              );
            const accumulator = append
              ? previous.accumulator
              : createModelAccumulator({ location });
            const checkpoint = scanScheduler(controller.signal);
            for (
              let index = append ? previous.prefix.length : 0;
              index < records.length;
              index += 256
            ) {
              {
                const waiting = checkpoint();
                if (waiting) await waiting;
              }
              accumulator.append(records.slice(index, index + 256));
            }
            const analysis = await responsive(
              accumulator.steps(),
              controller.signal,
            );
            controller.signal.throwIfAborted();
            if (
              records.length <= 100000 &&
              records.every(
                (r) =>
                  Object.isFrozen(r) &&
                  (!r.performance || Object.isFrozen(r.performance)),
              )
            )
              incremental = { prefix: records.slice(), accumulator };
            const result = {
              at: now(),
              ...(revision === undefined ? {} : { revision }),
              source: {
                metadata: source.metadata,
                records: records.filter((r) => r.type === "gap"),
              },
              analysis,
            };
            archive = result;
            return result;
          })
          .finally(() => {
            if (scan === job) scan = undefined;
          }),
      };
      scan = job;
    }
    const job = scan;
    job.waiters++;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([
        job.promise,
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error("Analytics read cancelled"));
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (--job.waiters === 0) job.controller.abort();
    }
  }
  const queryKey = (input: AnalyticsRead) =>
    JSON.stringify([input.from, input.to, input.agent ?? null]);
  function pageOffset(
    cursor: string | undefined,
    snapshot: Snapshot,
    kind: "models" | "requests",
    binding: string,
  ) {
    if (!cursor) return 0;
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(cursor, "base64url").toString(),
      );
      if (
        Array.isArray(parsed) &&
        parsed.length === 4 &&
        parsed[0] === snapshot.id &&
        parsed[1] === kind &&
        parsed[3] === createHash("sha256").update(binding).digest("hex") &&
        Number.isSafeInteger(parsed[2]) &&
        parsed[2] >= 0 &&
        parsed[2] % 50 === 0
      )
        return Number(parsed[2]);
    } catch {
      /* Opaque cursors never expose paths or arbitrary errors. */
    }
    throw new Error("Invalid analytics cursor; refresh Models");
  }
  const cursor = (
    snapshot: Snapshot,
    kind: string,
    offset: number,
    binding: string,
  ) =>
    Buffer.from(
      JSON.stringify([
        snapshot.id,
        kind,
        offset,
        createHash("sha256").update(binding).digest("hex"),
      ]),
    ).toString("base64url");
  return {
    async read(
      input: AnalyticsRead,
      signal: AbortSignal,
    ): Promise<AnalyticsResult> {
      if (!isAnalyticsRead(input)) throw new Error("Invalid analytics request");
      signal.throwIfAborted();
      if (stopped) throw new Error("Analytics service stopped");
      signal = AbortSignal.any([signal, shutdown.signal]);
      for (const [id, item] of snapshots)
        if (item.expiresAt <= now()) snapshots.delete(id);
      const current =
        options.revisioned && !input.snapshotId
          ? await load(signal)
          : undefined;
      let snapshot = input.snapshotId
        ? snapshots.get(input.snapshotId)
        : [...snapshots.values()].find(
            (s) =>
              s.key === queryKey(input) &&
              (current
                ? s.revision === current.revision
                : now() - s.generatedAt < 30000),
          );
      if (input.snapshotId && (!snapshot || snapshot.key !== queryKey(input)))
        throw new Error("Analytics snapshot expired; refresh Models");
      if (!snapshot) {
        if (projecting >= 2)
          throw new Error("Analytics service busy; retry later");
        projecting++;
        try {
          const data = current ?? (await load(signal));
          signal.throwIfAborted();
          let requests = data.analysis.requests.filter(
            (r) =>
              r.completedAt >= input.from &&
              r.completedAt < input.to &&
              (!input.agent || r.agent === input.agent),
          );
          requests = await responsive(sortRequests(requests), signal);
          const gaps = data.source.records
            .filter((r) => r.time >= input.from && r.time < input.to)
            .map((r) => r.time);
          snapshot = {
            id: crypto.randomUUID(),
            key: queryKey(input),
            generatedAt: data.at,
            expiresAt: now() + 90000,
            requests,
            models: await responsive(
              summarizeModelRequestSteps(requests),
              signal,
            ),
            coverage: data.analysis.coverage,
            metadata: data.source.metadata,
            gaps: gaps.slice(-128),
            omittedGaps: Math.max(0, gaps.length - 128),
            ...(data.revision === undefined ? {} : { revision: data.revision }),
            sorted: new Map(),
            variants: new Map(),
          };
          signal.throwIfAborted();
          snapshots.set(snapshot.id, snapshot);
          if (snapshots.size > 2) {
            const oldest = snapshots.keys().next().value;
            if (oldest) snapshots.delete(oldest);
          }
        } finally {
          projecting--;
        }
      }
      const sort = input.sort ?? "requests";
      const models =
        snapshot.sorted.get(sort) ??
        [...snapshot.models].sort((a, b) => {
          const key =
            sort === "tps"
              ? "averageTps"
              : sort === "ttft"
                ? "p95TtftMs"
                : "completedRequests";
          return (
            (sort === "identity"
              ? 0
              : (b[key] ?? -Infinity) - (a[key] ?? -Infinity)) ||
            (a.model ?? "").localeCompare(b.model ?? "")
          );
        });
      snapshot.sorted.set(sort, models);
      const modelOffset = pageOffset(
        input.modelCursor,
        snapshot,
        "models",
        sort,
      );
      const selected = input.unknownModel
        ? models.find((m) => m.model === undefined)
        : input.model
          ? models.find((m) => m.model === input.model)
          : models[modelOffset];
      const selection = selected?.model ?? "";
      const variantKey = JSON.stringify([
        selected?.model ?? null,
        !!selected,
        input.buckets,
      ]);
      let variant = snapshot.variants.get(variantKey);
      if (!variant) {
        const requests = selected
          ? snapshot.requests.filter((r) => r.model === selected.model)
          : [];
        variant = {
          requests,
          buckets: selected
            ? bucketModelRequests(requests, input.from, input.to, input.buckets)
            : [],
        };
      }
      snapshot.variants.delete(variantKey);
      snapshot.variants.set(variantKey, variant);
      if (snapshot.variants.size > 8) {
        const oldest = snapshot.variants.keys().next().value;
        if (oldest !== undefined) snapshot.variants.delete(oldest);
      }
      const requests = variant.requests;
      const requestOffset = pageOffset(
        input.requestCursor,
        snapshot,
        "requests",
        selection,
      );
      const buckets = structuredClone(variant.buckets);
      const result: AnalyticsResult = {
        schemaVersion: 1,
        generatedAt: snapshot.generatedAt,
        expiresAt: snapshot.expiresAt,
        snapshotId: snapshot.id,
        enabled,
        from: input.from,
        to: input.to,
        ...(input.agent ? { agent: input.agent } : {}),
        models: models
          .slice(modelOffset, modelOffset + 50)
          .map((m) => ({ ...m })),
        totalModels: models.length,
        ...(modelOffset + 50 < models.length
          ? {
              nextModelsCursor: cursor(
                snapshot,
                "models",
                modelOffset + 50,
                sort,
              ),
            }
          : {}),
        ...(selected ? { selected: { ...selected } } : {}),
        buckets,
        requests: requests.slice(requestOffset, requestOffset + 50).map((r) => {
          const { ttftMs, ...fact } = r;
          return {
            ...fact,
            ...(ttftMs !== undefined &&
            Number.isFinite(ttftMs) &&
            ttftMs >= 0 &&
            ttftMs <= r.completedAt - r.startedAt
              ? { ttftMs }
              : {}),
          };
        }),
        ...(requestOffset + 50 < requests.length
          ? {
              nextRequestsCursor: cursor(
                snapshot,
                "requests",
                requestOffset + 50,
                selection,
              ),
            }
          : {}),
        coverage: { ...snapshot.coverage },
        metadata: { ...snapshot.metadata },
        gaps: [...snapshot.gaps],
        omittedGaps: snapshot.omittedGaps,
      };
      if (!isAnalyticsResult(result))
        throw new Error("Analytics response exceeds supported bounds");
      return result;
    },
    dispose() {
      stopped = true;
      shutdown.abort();
      scan?.controller.abort();
      snapshots.clear();
      archive = undefined;
      incremental = undefined;
    },
  };
}

export async function serveModelAnalytics(
  port: AnalyticsRpcPort | undefined,
  path: string,
  location: string,
  enabled: boolean,
  options: Parameters<typeof createAnalyticsService>[3] = {},
) {
  if (!port) return () => {};
  const service = createAnalyticsService(path, location, enabled, options);
  const registration = await port.register(analyticsRpc, {
    read: async (input, context) => {
      if (!isAnalyticsRead(input)) throw new Error("Invalid analytics request");
      return service.read(input, context.signal);
    },
  });
  return async () => {
    service.dispose();
    await registration.dispose();
  };
}
