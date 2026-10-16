/** Sanitized simulated replay; no provider, filesystem journal, renderer or network. */
import { cpus } from "node:os";
import { parseConfig } from "../src/config.ts";
import { ContextMonitor } from "../src/monitor.ts";
import { CompactionScheduler } from "../src/scheduler.ts";
import { SnapshotStore } from "../src/snapshot.ts";
import { familyRows, type SessionNode } from "../src/family.ts";
import type { ContextSnapshot } from "../src/snapshot.ts";
const config = parseConfig({
  telemetry: { enabled: false },
  safety: { maxSessions: 1024 },
});
function run(consumers: number, projection: boolean) {
  let now = 1000000;
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
  const nodes: SessionNode[] = [];
  for (let i = 0; i < 1000; i++) {
    const id = `s${i}`;
    const state = monitor.touch(
      { sessionId: id, ...(i ? { parentId: "s0" } : {}), model: "fake/model" },
      { context: 128000, output: 8000 },
    );
    if (!state) throw new Error("capacity");
    state.active = i < 100;
    nodes.push({
      sessionId: id,
      ...(i ? { parentId: "s0" } : {}),
      status: state.active ? "running" : "idle",
    });
  }
  const store = new SnapshotStore(
    config,
    () => monitor.sessions,
    () => now,
    "benchmark",
  );
  const views = Array.from(
    { length: consumers },
    () => new Map<string, ContextSnapshot>(),
  );
  let messages = 0,
    bytes = 0;
  const flushMs: number[] = [],
    viewMs: number[] = [];
  store.listen((batch) => {
    messages++;
    bytes += new TextEncoder().encode(JSON.stringify(batch)).length;
    for (const view of views) {
      for (const row of batch.upserts) view.set(row.sessionId, row);
      for (const row of batch.removed) view.delete(row.sessionId);
    }
  });
  if (projection) store.flush();
  const before = process.memoryUsage(),
    cpu = process.cpuUsage(),
    start = performance.now();
  let updates = 0;
  // 10 simulated seconds at 100 updates/s, then 1 second at 1000 updates/s.
  for (let tick = 0; tick < 110; tick++) {
    now += 100;
    for (let j = 0; j < (tick < 100 ? 10 : 100); j++) {
      const id = `s${updates++ % 100}`,
        state = monitor.sessions.get(id);
      if (!state) throw new Error("missing session");
      monitor.measure(state, {
        tokens: 80000 + updates,
        at: now,
        model: "fake/model",
        provenance: "provider-normalized",
        confidence: "reported",
        scope: "completed-request",
      });
      if (projection) store.mark(id);
    }
    if (projection) {
      const at = performance.now();
      store.flush();
      flushMs.push(performance.now() - at);
    }
    for (const view of views) {
      const at = performance.now();
      familyRows(nodes, view, "s0", now, config.safety.staleMs);
      viewMs.push(performance.now() - at);
    }
  }
  const elapsedMs = performance.now() - start,
    used = process.cpuUsage(cpu),
    after = process.memoryUsage();
  const p95 = (values: number[]) =>
    values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
  return {
    projection,
    consumers,
    updates,
    elapsedMs,
    cpuMs: (used.user + used.system) / 1000,
    projectionP95Ms: p95(flushMs),
    viewP95Ms: p95(viewMs),
    messages,
    encodedBytesPerClient: bytes,
    residentRows: monitor.sessions.size,
    retainedClientRows: views.map((view) => view.size),
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss,
  };
}
console.log(
  JSON.stringify(
    {
      runtime: Bun.version,
      platform: process.platform,
      cpu: cpus()[0]?.model,
      simulatedSeconds: 11,
      results: [run(0, false), run(0, true), run(1, true), run(2, true)],
      unavailable: [
        "real network latency",
        "host CPU baseline",
        "30-minute memory plateau",
        "renderer frame changes",
      ],
    },
    null,
    2,
  ),
);
