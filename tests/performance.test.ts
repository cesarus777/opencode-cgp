import { expect, test } from "bun:test";
import { PerformanceTracker, outputTokens } from "../src/performance.ts";
import { parseConfig } from "../src/config.ts";
function fixture() {
  let now = 1000;
  const tracker = new PerformanceTracker(10, 2000, () => now);
  tracker.observe("root", 1000, 0);
  return {
    tracker,
    at: (n: number) => {
      now = n;
    },
  };
}
test("rolling estimates count fractional chunks and TTFT includes reasoning; chunks expire", () => {
  const { tracker: t, at } = fixture();
  t.start("root", "r", "build", "p/m", 1000);
  expect(t.snapshot("root")?.status).toBe("waiting");
  at(1200);
  t.delta("root", "r", "e1", 1200, 2);
  t.delta("root", "r", "e2", 1200, 2);
  t.delta("root", "r", "e1", 1200, 2);
  expect(t.snapshot("root")).toMatchObject({
    ttftMs: 200,
    liveTps: 5,
    estimatedOutputTokens: 1,
  });
  at(3300);
  expect(t.snapshot("root")?.liveTps).toBe(0);
});
test("model averages are duration weighted and exclude tools; lifetime average includes idle", () => {
  const { tracker: t, at } = fixture();
  t.start("root", "one", "build", "p/m", 1000);
  at(2000);
  t.streamed("root", "one", 2000);
  at(9000);
  t.settle("root", "one", 100);
  t.settle("root", "one", 100);
  expect(t.snapshot("root")).toMatchObject({
    modelOutputTokens: 100,
    modelDurationMs: 1000,
    latestRequestTps: 100,
    liveTps: 0,
  });
  t.start("root", "two", "review", "p/new", 9000);
  at(12000);
  t.streamed("root", "two", 12000);
  t.settle("root", "two", 60);
  t.observe("root", 1000, 160);
  expect(t.snapshot("root")).toMatchObject({
    averageModelTps: 40,
    averageSessionTps: 160 / 11,
    completedRequests: 2,
    requestAgent: "review",
    requestModel: "p/new",
  });
  at(17000);
  expect(t.snapshot("root")?.averageSessionTps).toBe(10);
});
test("same named concurrent agents stay separate and foreign requests cannot update output", () => {
  const { tracker: t, at } = fixture();
  t.observe("child", 1000, 0);
  for (const id of ["root", "child"]) t.start(id, id, "build", "p/m", 1000);
  at(1500);
  t.delta("child", "child", "e", 1500, 100);
  t.delta("root", "wrong", "x", 1500, 100);
  expect(t.snapshot("root")?.estimatedOutputTokens).toBe(0);
  expect(t.snapshot("child")?.estimatedOutputTokens).toBe(25);
});
test("missing usage, missing stream end and invalid clocks never invent rates", () => {
  const { tracker: t } = fixture();
  t.start("root", "one", "build", "p/m", 1000);
  t.streamed("root", "one", 1000);
  t.settle("root", "one", 20);
  expect(t.snapshot("root")).toMatchObject({
    partial: true,
    completedRequests: 0,
  });
  expect(t.snapshot("root")?.averageModelTps).toBeUndefined();
  t.start("root", "two", "build", "p/m", 1000);
  t.streamed("root", "two", 2000);
  t.settle("root", "two", undefined);
  expect(t.snapshot("root")?.tokenSource).toBe("unavailable");
  expect(outputTokens({ output: NaN, reasoning: 0 })).toBeUndefined();
});
test("bounded checkpoints restore matched totals and durable deduplication but invalidate live timing", () => {
  const { tracker: t, at } = fixture();
  t.accept("root", 2);
  t.start("root", "one", "build", "p/m", 1000);
  at(2000);
  t.streamed("root", "one", 2000);
  t.settle("root", "one", 50);
  const restored = new PerformanceTracker(1, 2000, () => 5000);
  restored.restore([...t.checkpoint(), { sessionId: "bad" }]);
  expect(restored.accept("root", 2)).toBe(false);
  expect(restored.snapshot("root")).toMatchObject({
    partial: true,
    averageModelTps: 50,
    status: "unavailable",
  });
  expect(restored.snapshot("root")?.ttftMs).toBeUndefined();
  restored.observe("overflow", 0, 0);
  expect(restored.snapshot("overflow")).toBeUndefined();
  restored.gap();
  expect(restored.snapshot("root")?.liveTps).toBeUndefined();
});
test("configuration validates configurable history and bounded sampling windows", () => {
  expect(parseConfig().history).toMatchObject({
    retentionDays: 7,
    maxBytes: 67108864,
    enabled: true,
  });
  expect(
    parseConfig({
      history: { retentionDays: 30, maxBytes: 8192, path: "/tmp/metrics" },
    }).history.retentionDays,
  ).toBe(30);
  for (const value of [
    { history: { retentionDays: 0 } },
    { history: { path: "relative" } },
    { metrics: { sampleIntervalMs: 1000, rollingWindowMs: 500 } },
    { metrics: { rollingWindowMs: 100000 } },
  ])
    expect(() => parseConfig(value)).toThrow();
});
