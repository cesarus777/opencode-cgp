/** Offline performance investigation. Run on the same Bun runtime as the dashboard. */
import { coldPrototypes, timed } from "./dashboard-cold-prototypes.ts";
import { PerformanceArchive } from "../src/archive.ts";
import { DashboardController } from "../src/dashboard/controller.ts";
import { discoverInventory } from "../src/dashboard/inventory.ts";
import { TerminalShell } from "../src/dashboard/terminal.ts";
import { readPerformanceHistory, type HistoryRecord } from "../src/history.ts";
import { createAnalyticsService } from "../src/modelanalyticsserver.ts";
import type { DashboardPort, SessionPageInput } from "../src/dashboard/port.ts";
import type { ContextSnapshot } from "../src/snapshot.ts";
import {
  mkdtemp,
  writeFile,
  rm,
  mkdir,
  appendFile,
  unlink,
} from "node:fs/promises";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";

const args = Bun.argv.slice(2);
if (args.some((arg) => arg !== "--requests"))
  throw new Error("Usage: bun run bench:dashboard [--requests]");
const requestWorkload = args.includes("--requests");

/** Synthetic scalar data only; no real server, sessions, or archive is opened. */
function syntheticSnapshot(sessionId: string): ContextSnapshot {
  return {
    sessionId,
    revision: 1,
    observedAt: 1000000,
    agent: "build",
    model: "synthetic/alpha",
    measurement: {
      tokens: 700,
      at: 1000000,
      model: "synthetic/alpha",
      provenance: "provider-normalized",
      confidence: "reported",
      scope: "completed-request",
    },
    capacityTokens: 1000,
    policy: {
      id: "defaults",
      configured: { type: "ratio", value: 0.8 },
      triggerTokens: 800,
      comparison: ">=",
      crossed: false,
      reason: "below-threshold",
    },
    compaction: { phase: "idle", armed: true },
    cumulativeScope: "unknown",
    lastObservedActive: true,
    performance: {
      sessionCreatedAt: 990000,
      observedSince: 995000,
      at: 1000000,
      status: "streaming",
      liveTps: 12,
      estimatedOutputTokens: 24,
      modelOutputTokens: 50,
      modelDurationMs: 2000,
      completedRequests: 1,
      tokenSource: "estimated",
      partial: true,
    },
  };
}
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
const measure = (work: () => void) => {
  for (let i = 0; i < 3; i++) work();
  const values = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    work();
    values.push(performance.now() - start);
  }
  return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
};
const results = [];
for (const count of [10, 100, 1024]) {
  const snapshots = Array.from({ length: count }, (_, i) =>
    syntheticSnapshot(`session-${String(i).padStart(8, "0")}`),
  );
  const byId = new Map(snapshots.map((s) => [s.sessionId, s]));
  const port: DashboardPort = {
    location: { directory: "/project" },
    atLocation() {
      throw new Error("Benchmark does not change locations");
    },
    async activeSessions(ids) {
      return ids;
    },
    async history() {
      throw new Error(
        "Benchmark does not request session history through the controller",
      );
    },
    async listSessions(input: SessionPageInput) {
      const offset = Number(input.cursor ?? 0);
      return {
        data:
          input.parentID === null
            ? snapshots.slice(offset, offset + 100).map((s) => ({
                sessionId: s.sessionId,
                directory: "/project",
                agent: "build",
                ...(s.model ? { model: s.model } : {}),
              }))
            : [],
        cursor: {
          next:
            input.parentID === null && offset + 100 < count
              ? String(offset + 100)
              : null,
        },
      };
    },
    async monitor() {
      return {
        version: 2 as const,
        transport: {
          async read(_location: string, ids: readonly string[]) {
            return {
              schemaVersion: 1,
              epoch: "bench",
              sequence: 1,
              generatedAt: 1000000,
              health: {
                enabled: true,
                mode: "observe",
                enforcement: "observing",
                reasons: [],
                staleMs: 300000,
                maxSessions: 1024,
              },
              upserts: ids.flatMap((id) => {
                const snapshot = byId.get(id);
                return snapshot ? [snapshot] : [];
              }),
              unavailable: [],
              removed: [],
            };
          },
          async *subscribe(_location: string, signal: AbortSignal) {
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
              if (signal.aborted) resolve();
            });
          },
        },
      };
    },
  };
  const controller = new DashboardController(port, {
    now: () => 1000000,
    elapsed: () => 0,
    refreshIntervalMs: 0,
  });
  try {
    await controller.start();
    const view = controller.getView();
    if (view.rows.length !== count || view.rows.some((row) => !row.snapshot))
      throw new Error("Benchmark monitor did not populate every session");
    const shell = new TerminalShell(controller, () => {});
    const frame80 = measure(() => {
      shell.frame(80, 24);
    });
    const frame40 = measure(() => {
      shell.frame(40, 20);
    });
    let index = 0;
    const selection = measure(() =>
      controller.selectSession(snapshots[index++ % count]?.sessionId ?? ""),
    );
    const delayedPort = {
      ...port,
      async listSessions(input: SessionPageInput, signal: AbortSignal) {
        await Bun.sleep(2);
        return port.listSessions(input, signal);
      },
    };
    const start = performance.now();
    const inventory = await discoverInventory(
      delayedPort,
      new AbortController().signal,
    );
    results.push({
      count,
      rows: controller.getView().rows.length,
      frame80,
      frame40,
      selection,
      discovery: {
        pages: inventory.pages,
        elapsedMs: performance.now() - start,
        complete: inventory.complete,
        notices: inventory.notices,
      },
    });
  } finally {
    controller.stop();
  }
}
const dir = await mkdtemp(join(tmpdir(), "guard-dashboard-bench-"));
try {
  const performanceSnapshot = syntheticSnapshot("template").performance;
  const line =
    JSON.stringify({
      schema: 1,
      recordId: "synthetic-record",
      time: 1000000,
      type: "sample",
      sessionId: "unrelated-session",
      agent: "build",
      model: "synthetic/alpha",
      performance: performanceSnapshot,
    }) + "\n";
  const block = line.repeat(
    Math.floor((4 * 1024 * 1024) / Buffer.byteLength(line)),
  );
  const archive = [];
  for (let i = 0; i < 16; i++) {
    let source = block;
    if (requestWorkload) {
      const lines: string[] = [];
      let bytes = 0;
      for (let j = 0; ; j++) {
        const requestId = `request-${i}-${j}`;
        const model = `synthetic/model-${j % 4}`;
        const record: HistoryRecord = {
          schema: 1,
          recordId: requestId,
          time: 1000000,
          type: "request",
          sessionId: `session-${String(j % 1024).padStart(8, "0")}`,
          model,
          agent: "build",
          performance: {
            sessionCreatedAt: 990000,
            observedSince: 995000,
            at: 1000000,
            status: "idle",
            partial: false,
            estimatedOutputTokens: 0,
            modelOutputTokens: 50,
            modelDurationMs: 1000,
            completedRequests: 1,
            tokenSource: "reported",
            requestId,
            requestModel: model,
            requestAgent: "build",
            requestStartedAt: 998999,
            streamEndedAt: 999999,
            requestOutputTokens: 50,
            ttftMs: 100,
          },
        };
        const line = JSON.stringify(record) + "\n";
        bytes += Buffer.byteLength(line);
        if (bytes > 4 * 1024 * 1024) break;
        lines.push(line);
      }
      source = lines.join("");
    }
    await writeFile(join(dir, `${1000000 + i}-aaaaaaaa-aaaa.jsonl`), source);
    if (![0, 3, 15].includes(i)) continue;
    let ticks = 0,
      maxDelay = 0,
      last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxDelay = Math.max(maxDelay, now - last - 10);
      last = now;
      ticks++;
    }, 10);
    const start = performance.now();
    let history: Awaited<ReturnType<typeof readPerformanceHistory>>;
    let historyMs: number;
    try {
      history = await readPerformanceHistory(dir, {
        sessionId: "session-00000000",
        from: 999000,
        to: 1000001,
      });
      historyMs = performance.now() - start;
      await Bun.sleep(15);
    } finally {
      clearInterval(timer);
    }
    const cancellableStart = performance.now();
    await readPerformanceHistory(dir, {
      sessionId: "session-00000000",
      from: 999000,
      to: 1000001,
      signal: new AbortController().signal,
    });
    const cancellableHistoryMs = performance.now() - cancellableStart;
    const shared = new PerformanceArchive(dir);
    const sharedCold = await timed(() =>
      shared.read({ sessionId: "session-00000000", from: 999000, to: 1000001 }),
    );
    const sharedColdMs = sharedCold.elapsedMs;
    const coldCounts = { ...shared.stats };
    const repeated: number[] = [];
    for (let repeat = 0; repeat < 5; repeat++) {
      const start = performance.now();
      await shared.read({
        sessionId: "session-00000000",
        from: 999000,
        to: 1000001,
      });
      repeated.push(performance.now() - start);
    }
    const repeatedCounts = { ...shared.stats };
    const service = createAnalyticsService(dir, "/project", true, {
      now: () => 1000001,
      read: (_path, filter) => shared.read(filter),
      revisioned: true,
    });
    const input = {
      schemaVersion: 1 as const,
      from: 999000,
      to: 1000001,
      buckets: 80,
    };
    try {
      const cold = await timed(() =>
        service.read(input, new AbortController().signal),
      );
      const analytics = cold.result;
      const coldMs = cold.elapsedMs;
      const warmStart = performance.now();
      await service.read(input, new AbortController().signal);
      const warmMs = performance.now() - warmStart;
      if (requestWorkload && analytics.totalModels !== 4)
        throw new Error("Benchmark archive did not populate all four models");
      archive.push({
        archiveMiB: history.metadata.retainedBytes / 1024 / 1024,
        sharedColdMs,
        sharedMaxTimerDelayMs: sharedCold.maxTimerDelayMs,
        analyticsMaxTimerDelayMs: cold.maxTimerDelayMs,
        sharedWarmP95Ms: percentile(repeated, 0.95),
        coldCounts,
        repeatedCounts,
        memory: process.memoryUsage(),
        historyMs,
        cancellableHistoryMs,
        historyMaxTimerDelayMs: maxDelay,
        historyTimerTicks: ticks,
        matchedRecords: history.records.length,
        analyticsColdMs: coldMs,
        analyticsWarmMs: warmMs,
        completedRequests: analytics.models.reduce(
          (sum, model) => sum + model.completedRequests,
          0,
        ),
        totalModels: analytics.totalModels,
        coverage: analytics.coverage,
      });
    } finally {
      service.dispose();
      shared.dispose();
    }
  }
  const mutationPath = join(dir, "mutations");
  await mkdir(mutationPath);
  const mutationName = "1-aa.jsonl",
    mutationFile = join(mutationPath, mutationName);
  await writeFile(mutationFile, block);
  const mutationReader = new PerformanceArchive(mutationPath);
  const mixedStart = performance.now();
  await Promise.all([
    mutationReader.read({ sessionId: "unrelated-session" }),
    mutationReader.read(),
  ]);
  const mixedMs = performance.now() - mixedStart,
    mixedCounts = { ...mutationReader.stats };
  if (mixedCounts.readBytes !== Buffer.byteLength(block))
    throw new Error("Mixed consumers duplicated scan work");
  const appendStart = performance.now();
  await appendFile(mutationFile, line);
  mutationReader.invalidate(mutationName);
  await mutationReader.read();
  const appendMs = performance.now() - appendStart;
  const appendReadBytes =
    mutationReader.stats.readBytes - mixedCounts.readBytes;
  const appendParsedRecords =
    mutationReader.stats.parsedRecords - mixedCounts.parsedRecords;
  if (appendReadBytes !== Buffer.byteLength(line) || appendParsedRecords !== 1)
    throw new Error("Append reread the prefix");
  await unlink(mutationFile);
  mutationReader.invalidate(mutationName);
  const pruned = await mutationReader.read();
  if (pruned.records.length || pruned.metadata.retainedBytes)
    throw new Error("Pruned archive retained records");
  mutationReader.dispose();
  const abortReader = new PerformanceArchive(dir);
  const abort = new AbortController();
  let abortedAt = performance.now();
  const abortTimer = setTimeout(() => {
    abortedAt = performance.now();
    abort.abort();
  }, 5);
  try {
    await abortReader.read({ signal: abort.signal });
    throw new Error("Cold scan completed before benchmark cancellation");
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    clearTimeout(abortTimer);
    abortReader.dispose();
  }
  const abortSettlementMs = performance.now() - abortedAt;
  await Bun.sleep(10);
  const incremental = {
    mixedMs,
    mixedCounts,
    appendMs,
    appendReadBytes,
    appendParsedRecords,
    pruneRetainedBytes: pruned.metadata.retainedBytes,
    abortSettlementMs,
  };
  const firstReadPrototypes = await coldPrototypes(dir);
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        runtime: Bun.version,
        cpu: cpus()[0]?.model,
        warmupIterations: 3,
        measuredIterations: 15,
        simulatedInventoryRequestDelayMs: 2,
        firstReadPrototypes,
        incremental,
        maxRssKiB: process.resourceUsage().maxRSS,
        archiveWorkload: requestWorkload
          ? "Distinct completed requests across 1024 sessions and four models"
          : "Repeated valid samples without completed-request identity; isolates scanning overhead",
        dashboard: results,
        archive,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
