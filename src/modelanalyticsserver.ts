import type {
  RpcHandlers,
  RpcRegistration,
} from "@opencode/plugin/promise/rpc";
import { createHash } from "node:crypto";
import { readPerformanceHistory } from "./history.ts";
import {
  analyzeModelRequests,
  summarizeModelRequests,
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
type Archive = Awaited<ReturnType<typeof readPerformanceHistory>>;
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
}
const metadata: Archive["metadata"] = {
  schema: 1,
  retainedBytes: 0,
  skippedBytes: 0,
  malformedRecords: 0,
  completeness: "bounded-retention",
};

/** One instance owns exactly one server-selected location/archive; no client paths. */
export function createAnalyticsService(
  path: string,
  location: string,
  enabled: boolean,
  options: { now?: () => number; read?: typeof readPerformanceHistory } = {},
) {
  const now = options.now ?? Date.now;
  const reader = options.read ?? readPerformanceHistory;
  const snapshots = new Map<string, Snapshot>();
  let stopped = false;
  let archive: { at: number; source: Archive; analysis: Analysis } | undefined;
  type Scan = {
    promise: Promise<NonNullable<typeof archive>>;
    controller: AbortController;
    waiters: number;
  };
  let scan: Scan | undefined;
  async function load(signal: AbortSignal) {
    if (archive && now() - archive.at < 30000) return archive;
    if (!scan || scan.controller.signal.aborted) {
      const controller = new AbortController();
      const job: Scan = {
        controller,
        waiters: 0,
        promise: Promise.resolve()
          .then(async () => {
            const source = enabled
              ? await reader(path, { signal: controller.signal })
              : { metadata, records: [] };
            controller.signal.throwIfAborted();
            if (stopped) throw new Error("Analytics service stopped");
            const analysis = analyzeModelRequests(source.records, { location });
            const result = {
              at: now(),
              source: {
                metadata: source.metadata,
                records: source.records.filter((r) => r.type === "gap"),
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
      for (const [id, item] of snapshots)
        if (item.expiresAt <= now()) snapshots.delete(id);
      let snapshot = input.snapshotId
        ? snapshots.get(input.snapshotId)
        : [...snapshots.values()].find(
            (s) => s.key === queryKey(input) && now() - s.generatedAt < 30000,
          );
      if (input.snapshotId && (!snapshot || snapshot.key !== queryKey(input)))
        throw new Error("Analytics snapshot expired; refresh Models");
      if (!snapshot) {
        const data = await load(signal);
        signal.throwIfAborted();
        const requests = data.analysis.requests.filter(
          (r) =>
            r.completedAt >= input.from &&
            r.completedAt < input.to &&
            (!input.agent || r.agent === input.agent),
        );
        requests.sort(
          (a, b) =>
            b.completedAt - a.completedAt ||
            a.sessionId.localeCompare(b.sessionId) ||
            a.requestId.localeCompare(b.requestId) ||
            a.startedAt - b.startedAt,
        );
        const gaps = data.source.records
          .filter((r) => r.time >= input.from && r.time < input.to)
          .map((r) => r.time);
        snapshot = {
          id: crypto.randomUUID(),
          key: queryKey(input),
          generatedAt: data.at,
          expiresAt: now() + 90000,
          requests,
          models: summarizeModelRequests(requests),
          coverage: data.analysis.coverage,
          metadata: data.source.metadata,
          gaps: gaps.slice(-128),
          omittedGaps: Math.max(0, gaps.length - 128),
        };
        snapshots.set(snapshot.id, snapshot);
        if (snapshots.size > 2) {
          const oldest = snapshots.keys().next().value;
          if (oldest) snapshots.delete(oldest);
        }
      }
      const sort = input.sort ?? "requests";
      const models = [...snapshot.models].sort((a, b) => {
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
      const requests = selected
        ? snapshot.requests.filter((r) => r.model === selected.model)
        : [];
      const requestOffset = pageOffset(
        input.requestCursor,
        snapshot,
        "requests",
        selection,
      );
      const buckets = selected
        ? bucketModelRequests(requests, input.from, input.to, input.buckets)
        : [];
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
      scan?.controller.abort();
      snapshots.clear();
      archive = undefined;
    },
  };
}

export async function serveModelAnalytics(
  port: AnalyticsRpcPort | undefined,
  path: string,
  location: string,
  enabled: boolean,
) {
  if (!port) return () => {};
  const service = createAnalyticsService(path, location, enabled);
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
