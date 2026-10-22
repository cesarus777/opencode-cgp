import { expect, test } from "bun:test";
import {
  contextChart,
  updateContextTrace,
  ContextTraceStore,
} from "../src/tui/contextchart.ts";
import { sidebarFamily } from "./fixtures/sidebar.ts";
import { cells } from "../src/tui/format.ts";

test("context chart fixes its scale to capacity and draws the threshold across the plot", () => {
  const chart = contextChart(
    [
      { at: 1, tokens: 25 },
      { at: 2, tokens: 75 },
    ],
    100,
    50,
    20,
  );
  expect(chart).toHaveLength(9);
  expect(chart[0]?.line).toStartWith("100%│");
  expect(chart[7]?.line).toStartWith("  0%│");
  expect(chart.filter((line) => line.threshold)).toEqual([
    { line: "    │┄┄┄┄┄┄┄┄┄┄┄┄┄╂│", threshold: true },
  ]);
  // Adding a higher point never changes the capacity axis or threshold position.
  const higher = contextChart(
    [
      { at: 1, tokens: 25 },
      { at: 2, tokens: 200 },
    ],
    100,
    50,
    20,
  );
  expect(higher[0]?.line).toEndWith("█│");
  expect(higher.findIndex((line) => line.threshold)).toBe(
    chart.findIndex((line) => line.threshold),
  );
  expect(chart[0]?.line).not.toContain("█");
});

test("context chart keeps missing samples blank, zero at the baseline, and compaction drops", () => {
  const plot = contextChart(
    [{ at: 1, tokens: 100 }, { at: 2 }, { at: 3, tokens: 0 }],
    100,
    undefined,
    8,
  );
  expect(plot[0]?.line).toBe("│   █  │");
  expect(plot[7]?.line).toBe("│   █ ▁│");
  expect(plot.some((line) => line.threshold)).toBe(false);
  for (const trigger of [0, 100])
    expect(
      contextChart([], 100, trigger, 8).filter((line) => line.threshold),
    ).toHaveLength(1);
  expect(contextChart([], 100, 200, 8).some((line) => line.threshold)).toBe(
    false,
  );
  for (const capacity of [undefined, 0, -1, Infinity])
    expect(contextChart([], capacity, 50, 20)).toEqual([]);
  for (const width of [4, 8, 16, 20, 35, 80, 200])
    expect(
      contextChart([], 100, 50, width).every(
        (line) => cells(line.line) <= width,
      ),
    ).toBe(true);
});

test("context history deduplicates renders, replaces corrections and is bounded to 96 measurements", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot?.measurement) throw new Error("Missing fixture");
  const snapshot = row.snapshot;
  const measurement = snapshot.measurement;
  if (!measurement) throw new Error("Missing measurement");
  let trace = updateContextTrace(undefined, row);
  expect(updateContextTrace(trace, row).samples).toEqual(trace.samples);
  const lowerCorrection = updateContextTrace(trace, {
    ...row,
    snapshot: { ...snapshot, measurement: { ...measurement, tokens: 10000 } },
  });
  expect(lowerCorrection.samples.at(-1)).toEqual({
    at: 1000,
    tokens: 112000,
    held: true,
  });
  const corrected = updateContextTrace(trace, {
    ...row,
    snapshot: { ...snapshot, measurement: { ...measurement, tokens: 120000 } },
  });
  expect(corrected.samples).toEqual([{ at: 1000, tokens: 120000 }]);
  for (let at = 1001; at < 1200; at++)
    trace = updateContextTrace(trace, {
      ...row,
      snapshot: {
        ...snapshot,
        measurement: { ...measurement, at, tokens: at },
      },
    });
  expect(trace.samples).toHaveLength(96);
  expect(trace.samples.at(-1)?.at).toBe(1199);
  expect(updateContextTrace(trace, row).samples).toEqual(trace.samples);
  expect(
    updateContextTrace(trace, { ...row, freshness: "stale" }).samples,
  ).toEqual(trace.samples);
  expect(
    updateContextTrace(undefined, { ...row, freshness: "invalid" }).samples[0]
      ?.tokens,
  ).toBeUndefined();
});

test("context history resets on session, model and capacity changes", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot?.measurement) throw new Error("Missing fixture");
  const trace = updateContextTrace(undefined, row);
  const next = {
    ...row.snapshot,
    measurement: { ...row.snapshot.measurement, at: 2000 },
  };
  for (const changed of [
    { ...row, node: { ...row.node, sessionId: "another" }, snapshot: next },
    { ...row, snapshot: { ...next, model: "different" } },
    { ...row, snapshot: { ...next, capacityTokens: 1000000 } },
  ]) {
    const reset = updateContextTrace(trace, changed);
    expect(reset.samples).toHaveLength(1);
    expect(reset.samples[0]?.at).toBe(2000);
  }
  expect(updateContextTrace(trace, undefined).samples).toEqual([]);
});

test("pauses retain the last level, lower observations are display-only and recovery grows from the plateau", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot?.measurement) throw new Error("Missing fixture");
  const snapshot = row.snapshot;
  const measurement = snapshot.measurement;
  if (!measurement) throw new Error("Missing measurement");
  let trace = updateContextTrace(undefined, row);
  const { measurement: _, ...missing } = snapshot;
  trace = updateContextTrace(trace, {
    ...row,
    freshness: "missing",
    snapshot: { ...missing, observedAt: 2000 },
  });
  expect(trace.samples.at(-1)).toEqual({
    at: 2000,
    tokens: 112000,
    held: true,
  });
  const lower = {
    ...row,
    snapshot: {
      ...snapshot,
      measurement: { ...measurement, at: 3000, tokens: 20000 },
    },
  };
  trace = updateContextTrace(trace, lower);
  expect(trace.samples.at(-1)?.tokens).toBe(112000);
  expect(trace.samples.at(-1)?.held).toBe(true);
  expect(lower.snapshot.measurement.tokens).toBe(20000);
  trace = updateContextTrace(trace, {
    ...row,
    snapshot: {
      ...snapshot,
      measurement: { ...measurement, at: 10000, tokens: 150000 },
    },
  });
  expect(trace.samples.slice(-2)).toEqual([
    { at: 9999, tokens: 112000, held: true },
    { at: 10000, tokens: 150000 },
  ]);
  expect(updateContextTrace(trace, lower).samples).toEqual(trace.samples);
});

test("only completed compaction plus a new reported measurement allows a drop; duplicate renders keep it", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot?.measurement) throw new Error("Missing fixture");
  const snapshot = row.snapshot;
  const measurement = snapshot.measurement;
  if (!measurement) throw new Error("Missing measurement");
  let trace = updateContextTrace(undefined, row);
  const at = (
    time: number,
    phase: typeof snapshot.compaction.phase,
    completed?: number,
    estimated = false,
  ) => ({
    ...row,
    snapshot: {
      ...snapshot,
      observedAt: time,
      measurement: {
        ...measurement,
        at: time,
        tokens: 20000,
        ...(estimated
          ? {
              confidence: "approximate" as const,
              scope: "prepared-request" as const,
            }
          : {}),
      },
      compaction: {
        ...snapshot.compaction,
        phase,
        ...(completed === undefined ? {} : { lastCompleted: completed }),
      },
    },
  });
  trace = updateContextTrace(trace, at(2000, "accepted"));
  expect(trace.samples.at(-1)?.tokens).toBe(112000);
  trace = updateContextTrace(trace, at(3000, "running"));
  expect(trace.samples.at(-1)?.tokens).toBe(112000);
  trace = updateContextTrace(trace, at(4000, "idle")); // failure/abandonment is no completion
  expect(trace.samples.at(-1)?.tokens).toBe(112000);
  trace = updateContextTrace(
    trace,
    at(5000, "awaiting-measurement", 4500, true),
  );
  expect(trace.samples.at(-1)?.tokens).toBe(112000);
  expect(trace.pendingCompleted).toBe(4500);
  const post = at(6000, "idle", 4500);
  trace = updateContextTrace(trace, post);
  expect(trace.samples.at(-1)?.tokens).toBe(20000);
  expect(trace.pendingCompleted).toBeUndefined();
  expect(updateContextTrace(trace, post).samples).toEqual(trace.samples);
  trace = updateContextTrace(trace, at(7000, "idle", 4500));
  expect(trace.samples.at(-1)?.tokens).toBe(20000);
  expect(trace.samples[0]?.tokens).toBe(112000);
});

test("idle rendering uses one marked tail without storing timer measurements or losing narrow layout", () => {
  const samples = [{ at: 1000, tokens: 70000 }];
  for (const width of [4, 8, 16, 35, 80]) {
    const plot = contextChart(samples, 100000, 80000, width, 10000);
    expect(plot.some((line) => line.line.includes("┈"))).toBe(true);
    expect(plot.every((line) => cells(line.line) <= width)).toBe(true);
    expect(
      plot.some((line) =>
        line.segments?.some((part) => part.held && part.text.includes("┈")),
      ),
    ).toBe(true);
    expect(
      plot.every(
        (line) =>
          !line.segments ||
          line.segments.map((s) => s.text).join("") === line.line,
      ),
    ).toBe(true);
  }
  expect(samples).toEqual([{ at: 1000, tokens: 70000 }]);
  expect(
    contextChart([], 100000, undefined, 20, 10000).some((line) =>
      line.line.includes("┈"),
    ),
  ).toBe(false);
});

test("shared traces survive panel/sidebar remounts, isolate sessions and bound retained sessions", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot?.measurement) throw new Error("Missing fixture");
  const store = new ContextTraceStore();
  store.update(row);
  const low = {
    ...row,
    snapshot: {
      ...row.snapshot,
      measurement: { ...row.snapshot.measurement, at: 2000, tokens: 20000 },
    },
  };
  expect(store.update(low).samples.at(-1)?.tokens).toBe(112000);
  store.update(undefined); // one view unmounts or is loading
  expect(store.update(low).samples[0]?.tokens).toBe(112000);
  const compacted = {
    ...low,
    snapshot: {
      ...low.snapshot,
      compaction: { ...low.snapshot.compaction, lastCompleted: 2500 },
      measurement: { ...low.snapshot.measurement, at: 3000 },
    },
  };
  store.update(compacted);
  expect(
    store.update(compacted).samples.map((sample) => sample.tokens),
  ).toEqual([112000, 112000, 20000]);
  for (let i = 0; i < 128; i++)
    store.update({ ...low, node: { ...low.node, sessionId: `other-${i}` } });
  expect(store.update(low).samples).toEqual([{ at: 2000, tokens: 20000 }]);
  store.clear();
  expect(store.update(row).samples).toEqual([{ at: 1000, tokens: 112000 }]);
});
