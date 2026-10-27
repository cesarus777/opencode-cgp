import { expect, test } from "bun:test";
import { DashboardController } from "../src/dashboard/controller.ts";
import type { DashboardPort, DashboardSession } from "../src/dashboard/port.ts";
import type { DashboardView } from "../src/dashboard/view.ts";
import type {
  ContextSnapshot,
  SnapshotBatch,
  SnapshotReadResult,
} from "../src/snapshot.ts";
import type {
  HistoryChartRead,
  HistoryChartResult,
} from "../src/historycharts.ts";
import type { ChartRequest } from "../src/charts.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error("Dashboard state did not settle");
}
class Events {
  private values: SnapshotBatch[] = [];
  private wake: (() => void) | undefined;
  push(value: SnapshotBatch) {
    this.values.push(value);
    this.wake?.();
  }
  async *stream(signal: AbortSignal) {
    while (!signal.aborted) {
      const value = this.values.shift();
      if (value) {
        yield value;
        continue;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          signal.removeEventListener("abort", done);
          this.wake = undefined;
          resolve();
        };
        this.wake = done;
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  }
}
const session = (sessionId: string, parentId?: string): DashboardSession => ({
  sessionId,
  directory: "/project",
  agent: "build",
  model: "provider/model",
  ...(parentId ? { parentId } : {}),
});
function snapshot(sessionId: string, tokens = 700): ContextSnapshot {
  return {
    sessionId,
    revision: 1,
    observedAt: 1000000,
    model: "provider/model",
    measurement: {
      tokens,
      at: 1000000,
      model: "provider/model",
      provenance: "provider-normalized",
      confidence: "reported",
      scope: "completed-request",
    },
    capacityTokens: 1000,
    policy: {
      id: "defaults",
      configured: { type: "ratio", value: 0.8 },
      comparison: ">=",
      triggerTokens: 800,
      reason: "below-threshold",
      crossed: false,
    },
    compaction: { phase: "idle", armed: true },
    cumulativeScope: "unknown",
    lastObservedActive: false,
    performance: {
      sessionCreatedAt: 1,
      observedSince: 1,
      at: 1000000,
      status: "streaming",
      partial: true,
      liveTps: 40,
      estimatedOutputTokens: 10,
      modelOutputTokens: 100,
      modelDurationMs: 1000,
      completedRequests: 1,
      tokenSource: "estimated",
    },
  };
}
function history(
  sessionId: string,
  requests: ChartRequest[] = [],
): HistoryChartResult {
  return {
    schemaVersion: 1,
    generatedAt: 1000000,
    enabled: true,
    truncated: false,
    metadata: {
      schema: 1,
      retainedBytes: 10,
      skippedBytes: 0,
      malformedRecords: 0,
      completeness: "bounded-retention",
    },
    data: {
      schema: 1,
      maxPoints: 500,
      omittedSessions: 0,
      gaps: [],
      series: [
        {
          sessionId,
          agents: [],
          models: [],
          points: [],
          requests,
          originalPoints: 0,
        },
      ],
    },
  };
}
class FakeLocation {
  sessions: DashboardSession[] = [
    session("root"),
    session("child", "root"),
    session("other", "root"),
  ];
  snapshots = new Map(
    this.sessions.map((session) => [
      session.sessionId,
      snapshot(session.sessionId),
    ]),
  );
  events = new Events();
  active = ["child", "other"];
  streams = 0;
  maxStreams = 0;
  probes = 0;
  version: 1 | 2 = 2;
  sequence = 1;
  epoch = "epoch-a";
  failInventory = false;
  failActive = false;
  failRead = false;
  reads: readonly string[][] = [];
  historyCalls: { input: HistoryChartRead; signal: AbortSignal }[] = [];
  readOverride: ((ids: readonly string[]) => Promise<unknown>) | undefined;
  historyOverride:
    | ((
        input: HistoryChartRead,
        signal: AbortSignal,
      ) => Promise<HistoryChartResult>)
    | undefined;
  inventoryGate: Promise<void> | undefined;
  baseline(ids: readonly string[]): SnapshotReadResult {
    const upserts = ids.flatMap((id) => {
      const row = this.snapshots.get(id);
      if (!row) return [];
      const { performance, ...context } = row;
      return [
        { ...(this.version === 1 ? context : row), revision: this.sequence },
      ];
    });
    return {
      schemaVersion: 1,
      epoch: this.epoch,
      sequence: this.sequence,
      generatedAt: 1000000,
      health: {
        enabled: true,
        mode: "observe",
        enforcement: "observing",
        reasons: [],
        staleMs: 300000,
        maxSessions: 1024,
      },
      upserts,
      removed: [],
      unavailable: ids
        .filter((id) => !this.snapshots.has(id))
        .map((sessionId) => ({ sessionId, reason: "not-monitored" })),
    };
  }
}
function fixture() {
  const initial = new FakeLocation();
  const clock = { elapsed: 0 };
  const locations = new Map([["/project", initial]]);
  const port = (directory: string): DashboardPort => {
    let state = locations.get(directory);
    if (!state) {
      state = new FakeLocation();
      state.sessions = state.sessions.map((session) => ({
        ...session,
        directory,
      }));
      locations.set(directory, state);
    }
    const source = state;
    return {
      location: { directory },
      atLocation: port,
      async listSessions(input) {
        await source.inventoryGate;
        if (source.failInventory) throw new Error("private-canary");
        const nodes = source.sessions.filter(
          (session) => (session.parentId ?? null) === input.parentID,
        );
        const offset = Number(input.cursor ?? 0);
        return {
          data: nodes.slice(offset, offset + 100),
          cursor: {
            next: nodes.length > offset + 100 ? String(offset + 100) : null,
          },
        };
      },
      async activeSessions(ids) {
        if (source.failActive) throw new Error("private-canary");
        return source.active.filter((id) => ids.includes(id));
      },
      async monitor() {
        source.probes++;
        return {
          version: source.version,
          transport: {
            async read(_location, ids) {
              source.reads = [...source.reads, [...ids]];
              if (source.failRead) throw new Error("private-canary");
              return source.readOverride
                ? source.readOverride(ids)
                : source.baseline(ids);
            },
            async *subscribe(_location, signal) {
              source.streams++;
              source.maxStreams = Math.max(source.maxStreams, source.streams);
              try {
                yield* source.events.stream(signal);
              } finally {
                source.streams--;
              }
            },
          },
        };
      },
      async history(input, signal) {
        source.historyCalls.push({ input, signal });
        return source.historyOverride
          ? source.historyOverride(input, signal)
          : history(input.sessionId);
      },
    };
  };
  const controller = new DashboardController(port("/project"), {
    refreshIntervalMs: 0,
    now: () => 1000000,
    elapsed: () => clock.elapsed,
  });
  return { controller, source: initial, locations, port, clock };
}

test("controller shares one live stream, discovers children, exposes complete immutable metrics and keeps unknown usage absent", async () => {
  const { controller, source } = fixture();
  source.snapshots.delete("other");
  const views: DashboardView[] = [];
  const unsubscribe = controller.subscribe((view) => views.push(view));
  const unsubscribe2 = controller.subscribe(() => {});
  try {
    await controller.start();
    await controller.start();
    const view = controller.getView();
    expect(view.connection).toBe("live");
    expect(view.inventory).toMatchObject({
      complete: true,
      total: 3,
      active: 2,
      monitored: 2,
    });
    expect(view.rows.find((row) => row.node.sessionId === "child")?.depth).toBe(
      1,
    );
    expect(view.selected?.snapshot?.measurement?.tokens).toBe(700);
    expect(view.selected?.utilizationPercent).toBe(70);
    expect(view.selected?.snapshot?.performance?.liveTps).toBe(40);
    expect(
      view.rows.find((row) => row.node.sessionId === "other")?.snapshot,
    ).toBeUndefined();
    expect(
      view.rows.find((row) => row.node.sessionId === "other")?.freshness,
    ).toBe("missing");
    expect(source.streams).toBe(1);
    expect(source.probes).toBe(1);
    expect(source.historyCalls.length).toBe(0);
    expect(Object.isFrozen(view.rows)).toBe(true);
    expect(Object.isFrozen(view.selected?.snapshot?.measurement)).toBe(true);
    const previous = view.selected?.snapshot?.measurement;
    source.snapshots.set("root", snapshot("root", 900));
    source.sequence++;
    await controller.refresh();
    expect(previous?.tokens).toBe(700);
    expect(controller.getView().selected?.snapshot?.measurement?.tokens).toBe(
      900,
    );
    expect(views.length).toBeGreaterThan(2);
  } finally {
    unsubscribe();
    unsubscribe2();
    controller.stop();
  }
  await until(() => source.streams === 0);
});

test("controller preserves values but marks them stale during read interruptions and reconciles a gap and restart", async () => {
  const { controller, source } = fixture();
  try {
    await controller.start();
    source.failRead = true;
    await controller.refresh();
    expect(controller.getView().selected?.snapshot?.measurement?.tokens).toBe(
      700,
    );
    expect(controller.getView().selected).toMatchObject({
      liveStale: true,
      freshness: "stale",
      pressure: "unknown",
    });
    expect(controller.getView().selected?.pressureRatio).toBeUndefined();
    source.failRead = false;
    source.sequence = 5;
    source.snapshots.set("root", snapshot("root", 850));
    const { unavailable: _, ...batch } = source.baseline(["root"]);
    source.events.push(batch);
    await until(
      () =>
        controller.getView().connection === "live" &&
        controller.getView().selected?.snapshot?.measurement?.tokens === 850,
    );
    source.epoch = "epoch-b";
    source.sequence = 1;
    source.snapshots.set("root", snapshot("root", 100));
    const { unavailable: __, ...restart } = source.baseline(["root"]);
    source.events.push(restart);
    await until(
      () =>
        controller.getView().connection === "live" &&
        controller.getView().selected?.snapshot?.measurement?.tokens === 100,
    );
    expect(
      controller.getView().selected?.snapshot?.performance?.completedRequests,
    ).toBe(1);
  } finally {
    controller.stop();
  }
});

test("controller labels v1 performance unavailable and incomplete inventory retains previous sessions", async () => {
  const { controller, source } = fixture();
  source.version = 1;
  try {
    await controller.start();
    expect(controller.getView().notices).toContain(
      "performance-unavailable-v1",
    );
    expect(controller.getView().selected?.performanceAvailable).toBe(false);
    expect(
      controller.getView().selected?.snapshot?.performance,
    ).toBeUndefined();
    source.failInventory = true;
    await controller.refresh();
    expect(controller.getView().inventory).toMatchObject({
      complete: false,
      stale: true,
      total: 3,
    });
    expect(controller.getView().rows.every((row) => row.inventoryStale)).toBe(
      true,
    );
    expect(JSON.stringify(controller.getView())).not.toContain(
      "private-canary",
    );
    source.failInventory = false;
    source.sessions = [session("root")];
    await controller.refresh();
    expect(controller.getView().inventory.total).toBe(1);
  } finally {
    controller.stop();
  }
});

test("location switches cancel obsolete inventory and history without cross-location results or duplicate streams", async () => {
  const { controller, source, locations } = fixture();
  const oldHistory = deferred<HistoryChartResult>();
  source.historyOverride = () => oldHistory.promise;
  try {
    await controller.start();
    controller.setScreen("history");
    await until(() => source.historyCalls.length === 1);
    const obsolete = source.historyCalls[0];
    const scanGate = deferred<void>();
    source.inventoryGate = scanGate.promise;
    const refresh = controller.refresh();
    await controller.selectLocation("/other");
    expect(obsolete?.signal.aborted).toBe(true);
    expect(controller.getView().location).toBe("/other");
    expect(controller.getView().rows.length).toBe(3);
    scanGate.resolve();
    oldHistory.resolve(history("root"));
    await refresh;
    await until(() => controller.getView().history.status === "ready");
    expect(source.streams).toBe(0);
    expect(locations.get("/other")?.streams).toBe(1);
    expect(controller.getView().history.result?.data.series[0]?.sessionId).toBe(
      "root",
    );
    await controller.selectLocation("/project");
    expect(source.maxStreams).toBe(1);
  } finally {
    controller.stop();
  }
});

test("history cancels obsolete selections, serializes reads, caches windows and avoids reads for presentation filters", async () => {
  const { controller, source } = fixture();
  const pending = deferred<HistoryChartResult>();
  source.historyOverride = () => pending.promise;
  try {
    await controller.start();
    controller.setScreen("history");
    await until(() => source.historyCalls.length === 1);
    controller.selectSession("child");
    controller.setWindow(604800000);
    controller.setWindow(3600000);
    expect(source.historyCalls.length).toBe(1);
    expect(source.historyCalls[0]?.signal.aborted).toBe(true);
    source.historyOverride = async (input) => history(input.sessionId);
    pending.resolve(history("root"));
    await until(() => controller.getView().history.status === "ready");
    expect(source.historyCalls.length).toBe(2);
    expect(source.historyCalls[1]?.input).toMatchObject({
      sessionId: "child",
      maxPoints: 500,
      from: 0,
      to: 1000000,
    });
    controller.setWindow(300000);
    await until(
      () =>
        source.historyCalls.length === 3 &&
        controller.getView().history.status === "ready",
    );
    controller.setWindow(3600000);
    controller.setScreen("detail");
    controller.setScreen("history");
    controller.setFilters({ search: "CHILD", model: "provider/model" });
    expect(source.historyCalls.length).toBe(3);
    expect(controller.getView().rows.length).toBe(1);
    expect(controller.getView().selectedSessionId).toBe("child");
    await controller.refresh();
    await until(
      () =>
        source.historyCalls.length === 4 &&
        controller.getView().history.status === "ready",
    );
  } finally {
    controller.stop();
  }
});

test("history keeps matched provenance, gap/retention notices and duration-weighted rates under agent/model filtering", async () => {
  const { controller, source } = fixture();
  source.historyOverride = async (input) => ({
    ...history(input.sessionId, [
      {
        time: 900000,
        requestId: "r1",
        started: 899000,
        agent: "build",
        model: "p/m",
        partial: false,
        outputTokens: 100,
        durationMs: 1000,
        tps: 100,
      },
      {
        time: 910000,
        requestId: "r2",
        started: 901000,
        agent: "build",
        model: "p/m",
        partial: true,
        outputTokens: 100,
        durationMs: 9000,
        tps: 100 / 9,
      },
      {
        time: 920000,
        requestId: "unmatched",
        started: 919000,
        agent: "build",
        model: "p/m",
        partial: true,
        outputTokens: 900,
      },
      {
        time: 930000,
        requestId: "other",
        started: 929000,
        agent: "plan",
        model: "p/other",
        partial: false,
        outputTokens: 500,
        durationMs: 1000,
      },
    ]),
    truncated: true,
  });
  try {
    await controller.start();
    controller.setScreen("history");
    await until(() => controller.getView().history.status === "ready");
    controller.setFilters({ agent: "build", model: "p/m" });
    expect(controller.getView().history.summary).toEqual({
      source: "matched-request-records",
      observedRequests: 3,
      matchedRequests: 2,
      partial: true,
      outputTokens: 200,
      durationMs: 10000,
      averageModelTps: 20,
    });
    expect(controller.getView().history.notices).toContain("partial-history");
    expect(controller.getView().history.notices).toContain(
      "partial-measurements",
    );
    expect(source.historyCalls.length).toBe(1);
  } finally {
    controller.stop();
  }
});

test("history distinguishes disabled, unavailable and wrong-session responses and keeps the last successful data stale on failure", async () => {
  const { controller, source } = fixture();
  try {
    await controller.start();
    controller.setScreen("history");
    await until(() => controller.getView().history.status === "ready");
    source.historyOverride = async () => {
      throw new Error("private-canary");
    };
    await controller.refresh();
    await until(() => controller.getView().history.status === "unavailable");
    expect(controller.getView().history.result).toBeDefined();
    expect(controller.getView().history.stale).toBe(true);
    expect(JSON.stringify(controller.getView())).not.toContain(
      "private-canary",
    );
    source.historyOverride = async () => history("foreign");
    await controller.refresh();
    await until(() => controller.getView().history.status === "unavailable");
    expect(controller.getView().history.result?.data.series[0]?.sessionId).toBe(
      "root",
    );
    source.historyOverride = async (input) => ({
      ...history(input.sessionId),
      enabled: false,
    });
    await controller.refresh();
    await until(() => controller.getView().history.status === "disabled");
    expect(
      controller.getView().history.summary?.averageModelTps,
    ).toBeUndefined();
  } finally {
    controller.stop();
  }
});

test("stopping a pending controller aborts upstream work and late replies cannot publish or repopulate state", async () => {
  const { controller, source } = fixture();
  const pending = deferred<HistoryChartResult>();
  source.historyOverride = () => pending.promise;
  let notifications = 0;
  controller.subscribe(() => {
    notifications++;
  });
  await controller.start();
  controller.setScreen("history");
  await until(() => source.historyCalls.length === 1);
  controller.stop();
  expect(source.historyCalls[0]?.signal.aborted).toBe(true);
  const count = notifications;
  pending.resolve(history("root"));
  await until(() => source.streams === 0);
  await Promise.resolve();
  expect(notifications).toBe(count);
  expect(controller.getView().running).toBe(false);
});

test("measurement and performance age use server time plus elapsed time and expired usage retains occupancy without pressure", async () => {
  const { controller, clock } = fixture();
  try {
    await controller.start();
    clock.elapsed = 300001;
    controller.setFilters({});
    expect(controller.getView().selected).toMatchObject({
      freshness: "stale",
      performanceFreshness: "stale",
      measurementAgeMs: 300001,
      utilizationPercent: 70,
      pressure: "unknown",
    });
    expect(controller.getView().selected?.snapshot?.measurement?.tokens).toBe(
      700,
    );
    expect(controller.getView().selected?.pressureRatio).toBeUndefined();
  } finally {
    controller.stop();
  }
});

test("public execution failures stay unknown and success is taken only from native outcome metadata", async () => {
  const { controller, source } = fixture();
  source.failActive = true;
  try {
    await controller.start();
    expect(
      controller.getView().rows.every((row) => row.node.status === "unknown"),
    ).toBe(true);
    expect(controller.getView().inventory.complete).toBe(false);
    source.failActive = false;
    source.sessions = source.sessions.map((session) =>
      session.sessionId === "root"
        ? { ...session, outcome: "succeeded", terminalAt: 999999 }
        : session,
    );
    await controller.refresh();
    expect(controller.getView().selected?.node.status).toBe("completed");
    expect(
      controller.getView().rows.find((row) => row.node.sessionId === "child")
        ?.node.status,
    ).toBe("running");
  } finally {
    controller.stop();
  }
});

test("history cache and remembered locations stay bounded and repeated location navigation disposes every stream", async () => {
  const { controller, source, locations } = fixture();
  source.sessions = Array.from({ length: 18 }, (_, i) =>
    session(`session-${i}`),
  );
  try {
    await controller.start();
    controller.setScreen("history");
    await until(() => controller.getView().history.status === "ready");
    const first = controller.getView().selectedSessionId;
    expect(first).toBeDefined();
    for (const node of source.sessions) {
      controller.selectSession(node.sessionId);
      await until(() => controller.getView().history.status === "ready");
    }
    const before = source.historyCalls.length;
    if (first) controller.selectSession(first);
    await until(() => controller.getView().history.status === "ready");
    expect(source.historyCalls.length).toBe(before + 1);
    controller.setScreen("overview");
    for (let i = 0; i < 6; i++)
      await controller.selectLocation(`/location-${i}`);
    expect(controller.getView().locations.length).toBe(4);
    expect(controller.getView().locations).not.toContain("/project");
    await until(
      () =>
        [...locations.values()].reduce(
          (sum, location) => sum + location.streams,
          0,
        ) === 1,
    );
    expect(
      [...locations.values()].every((location) => location.maxStreams <= 1),
    ).toBe(true);
  } finally {
    controller.stop();
  }
  await until(() =>
    [...locations.values()].every((location) => location.streams === 0),
  );
});

test("controller reconciles large bounded inventories in 128-ID chunks with at most two concurrent reads", async () => {
  const { controller, source } = fixture();
  source.sessions = Array.from({ length: 260 }, (_, i) =>
    session(`session-${i}`),
  );
  let active = 0,
    maximum = 0;
  source.readOverride = async (ids) => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    return source.baseline(ids);
  };
  try {
    await controller.start();
    await until(() => controller.getView().connection === "live");
    expect(controller.getView().inventory.total).toBe(260);
    expect(source.reads.every((ids) => ids.length <= 128)).toBe(true);
    expect(source.reads.some((ids) => ids.length === 128)).toBe(true);
    expect(maximum).toBe(2);
    expect(controller.getView().inventory.notices).toContain("page-limit");
  } finally {
    controller.stop();
  }
});

test("view projection excludes arbitrary inventory/filter fields and rejects content-bearing snapshot payloads", async () => {
  const { controller, source } = fixture();
  const contaminated = {
    ...session("root"),
    title: "private-canary",
    metadata: { prompt: "private-canary" },
    credentials: "private-canary",
  };
  source.sessions = [contaminated];
  try {
    await controller.start();
    const filters = { search: "", toolOutput: "private-canary" };
    controller.setFilters(filters);
    expect(JSON.stringify(controller.getView())).not.toContain(
      "private-canary",
    );
    const badSnapshot = { ...snapshot("root"), prompt: "private-canary" };
    source.snapshots.set("root", badSnapshot);
    source.sequence++;
    await controller.refresh();
    expect(controller.getView().connection).toBe("incompatible");
    expect(controller.getView().selected?.snapshot?.measurement?.tokens).toBe(
      700,
    );
    expect(JSON.stringify(controller.getView())).not.toContain(
      "private-canary",
    );
  } finally {
    controller.stop();
  }
});
