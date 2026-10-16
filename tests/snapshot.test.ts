import { test, expect } from "bun:test";
import { parseConfig } from "../src/config.ts";
import { ContextMonitor } from "../src/monitor.ts";
import { CompactionScheduler } from "../src/scheduler.ts";
import { SnapshotStore, project } from "../src/snapshot.ts";
import { isBatch, isRead, isResult } from "../src/rpc.ts";
import type { SnapshotBatch } from "../src/snapshot.ts";
function fixture(
  threshold: { type: "tokens" | "ratio" | "remaining"; value: number } = {
    type: "tokens",
    value: 100,
  },
) {
  let now = 1000;
  const config = parseConfig({
    mode: "observe",
    safety: { minReclaimTokens: 1 },
    defaults: { threshold },
    telemetry: { enabled: false },
  });
  const sink = { emit() {} };
  const monitor = new ContextMonitor(
    config,
    new CompactionScheduler(
      config,
      { compact: async () => {} },
      sink,
      () => now,
    ),
    sink,
    () => now,
  );
  const s = monitor.touch(
    { sessionId: "root", model: "local/model" },
    { context: 1000, input: 800, output: 100 },
  )!;
  monitor.measure(s, {
    tokens: 100,
    at: now,
    model: "local/model",
    provenance: "provider-normalized",
    confidence: "reported",
    scope: "completed-request",
  });
  s.usage.cumulative = {
    input: 9000000,
    output: 30,
    reasoning: 40,
    cache: { read: 20, write: 10 },
  };
  const store = new SnapshotStore(
    config,
    () => monitor.sessions,
    () => now,
    "epoch",
  );
  return {
    config,
    monitor,
    s,
    store,
    advance(n: number) {
      now += n;
    },
  };
}
test("projection keeps prompt capacity and cumulative usage independent and clones nested values", () => {
  const f = fixture(),
    row = project(f.s, f.config, 1000);
  expect(row.capacityTokens).toBe(800);
  expect(row.policy.crossed).toBe(true);
  expect(row.measurement?.tokens).toBe(100);
  f.s.usage.cumulative!.cache.read = 999;
  f.s.limits!.input = 1;
  expect(row.cumulative?.cache.read).toBe(20);
  expect(row.limits?.input).toBe(800);
  expect(
    isBatch({
      schemaVersion: 1,
      epoch: "e",
      sequence: 1,
      generatedAt: 1000,
      health: f.store.health(),
      upserts: [row],
      removed: [],
    }),
  ).toBe(true);
});
test("remaining threshold is strict at equality and token/ratio are inclusive", () => {
  for (const type of ["tokens", "ratio", "remaining"] as const) {
    const f = fixture({
      type,
      value: type === "tokens" ? 100 : type === "ratio" ? 0.125 : 700,
    });
    expect(project(f.s, f.config, 1000).policy.crossed).toBe(
      type !== "remaining",
    );
    f.s.usage.current!.tokens++;
    expect(project(f.s, f.config, 1000).policy.crossed).toBe(true);
  }
});
test("freshness uses measurement time and invalidates future/model mismatch", () => {
  const f = fixture();
  expect(
    project(f.s, f.config, 1000 + f.config.safety.staleMs).policy.crossed,
  ).toBe(true);
  expect(
    project(f.s, f.config, 1001 + f.config.safety.staleMs).policy.reason,
  ).toBe("stale-usage");
  expect(project(f.s, f.config, 999).policy.reason).toBe("stale-usage");
  f.s.model = "other";
  expect(project(f.s, f.config, 1000).policy.reason).toBe("model-changed");
});
test("store emits material changes, tombstones, globally increasing revisions and immutable reads", () => {
  const f = fixture(),
    batches: SnapshotBatch[] = [];
  f.store.listen((b) => batches.push(b));
  const read = () =>
    f.store.read({ schemaVersion: 1, sessionIds: ["root", "unknown"] });
  const first = read();
  expect(isResult(first)).toBe(true);
  expect(first.unavailable).toEqual([
    { sessionId: "unknown", reason: "not-monitored" },
  ]);
  read();
  expect(batches.length).toBe(1);
  f.s.compaction.phase = "accepted";
  f.store.mark("root");
  const second = read();
  expect(first.upserts[0]?.compaction.phase).toBe("idle");
  expect(second.upserts[0]?.compaction.phase).toBe("accepted");
  f.store.remove("root");
  f.monitor.sessions.delete("root");
  read();
  expect(batches.at(-1)?.removed[0]?.reason).toBe("deleted");
  f.monitor.sessions.set("root", f.s);
  const third = read();
  expect(third.upserts[0]!.revision).toBeGreaterThan(
    second.upserts[0]!.revision,
  );
});
test("contract rejects unknown fields, malformed enums, duplicate IDs, oversized and nonfinite values", () => {
  const f = fixture(),
    result = f.store.read({ schemaVersion: 1, sessionIds: ["root"] });
  expect(isRead({ schemaVersion: 1, sessionIds: ["root", "root"] })).toBe(
    false,
  );
  expect(isRead({ schemaVersion: 2, sessionIds: [] })).toBe(false);
  expect(
    isRead({
      schemaVersion: 1,
      sessionIds: Array.from({ length: 129 }, (_, i) => String(i)),
    }),
  ).toBe(false);
  expect(isResult({ ...result, prompt: "secret" })).toBe(false);
  expect(isResult({ ...result, sequence: NaN })).toBe(false);
  expect(
    isResult({ ...result, upserts: [...result.upserts, ...result.upserts] }),
  ).toBe(false);
  expect(isResult({ ...result, epoch: "x".repeat(513) })).toBe(false);
});
test("read never evaluates scheduler or touches monitor residency and health survives telemetry absence", () => {
  const f = fixture();
  f.store.degrade("event-stream-gap");
  const size = f.monitor.sessions.size;
  f.store.read({ schemaVersion: 1, sessionIds: ["absent"] });
  expect(f.monitor.sessions.size).toBe(size);
  expect(f.store.health().enforcement).toBe("suspended");
  f.advance(f.config.safety.staleMs + 1);
  expect(
    f.store.read({ schemaVersion: 1, sessionIds: ["root"] }).upserts[0]?.policy
      .reason,
  ).toBe("stale-usage");
});

test("fractional ratios are valid contracts and projections exclude unexpected nested fields", () => {
  const f = fixture({ type: "ratio", value: 0.125 });
  Object.assign(f.s.usage.current!, { prompt: "private" });
  Object.assign(f.s.limits!, { secret: "private" });
  Object.assign(f.s.usage.cumulative!, { title: "private" });
  const result = f.store.read({ schemaVersion: 1, sessionIds: ["root"] });
  expect(isResult(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(isResult({ ...result, sequence: 1.5 })).toBe(false);
});

test("mixed removals and upserts use at most 128 changes per monotonically sequenced message", () => {
  const f = fixture(),
    batches: SnapshotBatch[] = [];
  for (let i = 0; i < 200; i++)
    f.monitor.sessions.set(`old${i}`, { ...f.s, sessionId: `old${i}` });
  f.store.flush();
  f.store.listen((batch) => batches.push(batch));
  for (let i = 0; i < 200; i++) {
    f.monitor.sessions.delete(`old${i}`);
    f.monitor.sessions.set(`new${i}`, { ...f.s, sessionId: `new${i}` });
  }
  f.store.flush();
  expect(batches.length).toBe(4);
  for (const batch of batches) {
    expect(batch.upserts.length + batch.removed.length).toBeLessThanOrEqual(
      128,
    );
    expect(isBatch(batch)).toBe(true);
  }
  expect(batches.flatMap((b) => b.removed).length).toBe(200);
  expect(batches.flatMap((b) => b.upserts).length).toBe(200);
});

test("sidebar statistics project observed peaks and completed counts without counting admissions", () => {
  const f = fixture();
  f.s.compaction.phase = "accepted";
  expect(project(f.s, f.config, 1000).compaction.count).toBe(0);
  expect(project(f.s, f.config, 1000).peakTokens).toBe(100);
  f.s.compaction.count = 2;
  f.s.compaction.phase = "awaiting-measurement";
  const result = f.store.read({ schemaVersion: 1, sessionIds: ["root"] });
  expect(isResult(result)).toBe(true);
  expect(result.upserts[0]?.compaction.count).toBe(2);
  expect(result.upserts[0]?.peakTokens).toBe(100);
});
