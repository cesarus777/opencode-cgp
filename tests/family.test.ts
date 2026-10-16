import { test, expect } from "bun:test";
import {
  familyRows,
  executionStatus,
  metric,
  type SessionNode,
} from "../src/family.ts";
import type { ContextSnapshot } from "../src/snapshot.ts";
function snapshot(sessionId: string, tokens: number): ContextSnapshot {
  return {
    sessionId,
    revision: 1,
    observedAt: 100,
    model: "m",
    measurement: {
      tokens,
      at: 100,
      model: "m",
      confidence: "reported",
      provenance: "provider-normalized",
      scope: "completed-request",
    },
    capacityTokens: 1000,
    policy: {
      id: "defaults",
      configured: { type: "tokens", value: 100 },
      triggerTokens: 100,
      comparison: ">=",
      reason: "below-threshold",
      crossed: false,
    },
    compaction: { phase: "idle", armed: true },
    cumulativeScope: "unknown",
    lastObservedActive: false,
  };
}
test("subtree pressure preserves nested edges and current ancestry", () => {
  const nodes: SessionNode[] = [
    { sessionId: "root", status: "idle" },
    { sessionId: "a", parentId: "root", status: "completed" },
    { sessionId: "b", parentId: "root", status: "running" },
    { sessionId: "deep", parentId: "a", status: "running" },
    { sessionId: "deeper", parentId: "deep", status: "idle" },
  ];
  const rows = familyRows(
    nodes,
    new Map([
      ["b", snapshot("b", 50)],
      ["deep", snapshot("deep", 110)],
    ]),
    "deeper",
    100,
    1000,
  );
  expect(rows.map((r) => [r.node.sessionId, r.depth])).toEqual([
    ["root", 0],
    ["a", 1],
    ["deep", 2],
    ["deeper", 3],
    ["b", 1],
  ]);
  expect(rows[1]?.hidden).toBe(0);
  expect(rows[3]?.current).toBe(true);
});
test("cycles, orphans and large trees are bounded", () => {
  const nodes: SessionNode[] = [
    { sessionId: "a", parentId: "b", status: "idle" },
    { sessionId: "b", parentId: "a", status: "idle" },
    { sessionId: "orphan", parentId: "missing", status: "unknown" },
  ];
  expect(
    new Set(
      familyRows(nodes, new Map(), "a", 0, 1).map((r) => r.node.sessionId),
    ).size,
  ).toBe(3);
  expect(
    familyRows(
      Array.from({ length: 1500 }, (_, i) => ({
        sessionId: String(i),
        status: "idle",
      })),
      new Map(),
      "0",
      0,
      1,
    ).length,
  ).toBe(1024);
});
test("completed branches collapse unless current or critical and stale pressure stays unknown", () => {
  const nodes: SessionNode[] = [
    { sessionId: "r", status: "idle" },
    { sessionId: "a", parentId: "r", status: "completed" },
    { sessionId: "b", parentId: "a", status: "completed" },
  ];
  expect(familyRows(nodes, new Map(), "r", 100, 100).length).toBe(2);
  expect(familyRows(nodes, new Map(), "b", 100, 100).length).toBe(3);
  expect(metric(snapshot("b", 200), 1000, 100).pressure).toBe("unknown");
  expect(metric(snapshot("b", 90), 100, 100).pressure).toBe("near");
});
test("running overrides prior success; terminal evidence cannot override a newer start", () => {
  expect(
    executionStatus(true, true, { outcome: "succeeded", terminalAt: 10 }),
  ).toBe("running");
  expect(
    executionStatus(true, false, {
      startedAt: 20,
      terminalAt: 10,
      outcome: "failed",
    }),
  ).toBe("running");
  expect(
    executionStatus(true, false, {
      startedAt: 20,
      terminalAt: 30,
      outcome: "interrupted",
    }),
  ).toBe("unknown");
  expect(executionStatus(false, false, {})).toBe("unknown");
  expect(executionStatus(true, false, {})).toBe("idle");
});
