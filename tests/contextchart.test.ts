import { expect, test } from "bun:test";
import { contextChart, updateContextTrace } from "../src/tui/contextchart.ts";
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
