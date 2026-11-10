import { expect, test } from "bun:test";
import {
  contextMeter,
  contextOccupancy,
  nativeWorkspaceLayout,
  workspacePerformance,
  workspaceTreeLines,
  performanceDisplayRow,
} from "../src/tui/workspaceformat.ts";
import { sidebarFamily } from "./fixtures/sidebar.ts";
import { cells } from "../src/tui/format.ts";
import { metric } from "../src/family.ts";

test("native workspace budgets use allocated content dimensions and retain constrained layouts", () => {
  expect(nativeWorkspaceLayout(109, 40).wide).toBe(false);
  expect(nativeWorkspaceLayout(110, 27).wide).toBe(false);
  for (const [width, height] of [
    [110, 28],
    [116, 38],
    [176, 48],
  ] as const) {
    const layout = nativeWorkspaceLayout(width, height);
    expect(layout.wide).toBe(true);
    expect(layout.treeWidth + layout.contentWidth + 2).toBe(width);
    expect(layout.treeWidth).toBeLessThanOrEqual(32);
    expect(layout.contentWidth).toBeGreaterThanOrEqual(79);
  }
});

test("native context bars use effective capacity and resolved thresholds, retain stale occupancy, and keep invalid usage unknown", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot) throw new Error("Missing fixture");
  for (const [comparison, count, pressure] of [
    [">=", 160000, "crossed"],
    [">", 160000, "near"],
    [">", 160001, "crossed"],
  ] as const) {
    const snapshot = {
      ...row.snapshot,
      policy: { ...row.snapshot.policy, comparison },
      measurement: {
        ...row.snapshot.measurement,
        tokens: count,
        at: 1000,
        model: "deepseek-flash",
        provenance: "provider-normalized" as const,
        scope: "completed-request" as const,
        confidence: "reported" as const,
      },
    };
    const projected = { ...row, snapshot, ...metric(snapshot, 1000, 1000) };
    expect(projected.pressure).toBe(pressure);
    const meter = contextMeter(projected, 50);
    expect(meter?.findIndex((cell) => cell.text === "┆")).toBe(16);
    expect(meter?.filter((cell) => cell.active).length).toBe(16);
  }
  expect(contextOccupancy({ ...row, freshness: "stale" })).toBe("22%");
  for (const freshness of ["invalid", "missing"] as const) {
    expect(contextMeter({ ...row, freshness }, 50)).toBeUndefined();
    expect(contextOccupancy({ ...row, freshness })).toBe("?%");
  }
  const beyond = {
    ...row,
    snapshot: {
      ...row.snapshot,
      policy: { ...row.snapshot.policy, triggerTokens: 600000 },
    },
    utilizationPercent: 150,
  };
  expect(contextMeter(beyond, 50)?.some((cell) => cell.text === "┆")).toBe(
    false,
  );
  expect(contextMeter(beyond, 50)?.filter((cell) => cell.active)).toHaveLength(
    50,
  );
  expect(contextOccupancy(beyond)).toBe("150%");
});

test("native performance freshness is independent of context and honors age boundaries, clock validity and disconnect", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot) throw new Error("Missing fixture");
  const performance = {
    sessionCreatedAt: 0,
    at: 1000,
    observedSince: 0,
    status: "streaming" as const,
    liveTps: 42.8,
    ttftMs: 820,
    averageModelTps: 38.6,
    averageSessionTps: 12.4,
    estimatedOutputTokens: 128,
    modelOutputTokens: 128,
    modelDurationMs: 3000,
    completedRequests: 2,
    tokenSource: "estimated" as const,
    partial: true,
  };
  const projected = {
    ...row,
    freshness: "missing" as const,
    snapshot: { ...row.snapshot, performance },
  };
  expect(workspacePerformance(projected, 2000, 1000, true).live).toBe("~42.8");
  expect(workspacePerformance(projected, 2000, 1000, true).ttft).toBe("~0.82s");
  for (const [now, live] of [
    [2001, true],
    [999, true],
    [1000, false],
  ] as const) {
    const values = workspacePerformance(projected, now, 1000, live);
    expect(values.live).toBe("?");
    expect(values.model).toBe("?");
    expect(values.session).toBe("?");
    expect(values.ttft).toBe("?");
    expect(values.partial).toBe(true);
    const display = performanceDisplayRow(projected, now, 1000, live);
    expect(display.snapshot?.performance?.liveTps).toBeUndefined();
    expect(display.snapshot?.measurement).toBe(projected.snapshot.measurement);
    expect(projected.snapshot.performance.liveTps).toBe(42.8);
  }
  expect(workspacePerformance(projected, undefined, 1000, true).live).toBe("?");
  expect(workspacePerformance(undefined, 1000, 1000, true).status).toBe(
    "unavailable",
  );
});

test("native family rail keeps selection, current route and lifecycle labels bounded with Unicode and terminal controls", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot) throw new Error("Missing fixture");
  const exceptional = {
    ...row,
    depth: 50,
    node: { ...row.node, agent: "研究👩‍💻\x1b[31m".repeat(50) },
    snapshot: {
      ...row.snapshot,
      compaction: { ...row.snapshot.compaction, phase: "accepted" as const },
    },
  };
  for (const width of [26, 29, 32]) {
    const lines = workspaceTreeLines(exceptional, true, 125, width);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toStartWith(">* #126");
    expect(lines[2]).toContain("Waiting");
    expect(
      lines.every((line) => cells(line) <= width && !line.includes("\x1b")),
    ).toBe(true);
  }
});
