import { expect, test } from "bun:test";
import {
  agentHeading,
  agentLines,
  mainLines,
  progress,
  statistics,
  subagentTree,
} from "../src/tui/compactformat.ts";
import { cells } from "../src/tui/format.ts";
import { metric, type GuardRow } from "../src/family.ts";
import { sidebarFamily } from "./fixtures/sidebar.ts";

test("sidebar renders independent occupancy and threshold bars, unknown and stale measurements", () => {
  const row = sidebarFamily()[0];
  expect(row).toBeDefined();
  if (!row?.snapshot) throw new Error("Missing fixture");
  for (const width of [16, 20, 35, 80]) {
    const lines = mainLines(row, width, 3000);
    expect(lines.every((line) => cells(line) <= width)).toBe(true);
    expect(lines.join(" ")).toContain("22%");
    expect(lines.join(" ")).toContain("70%");
    expect(lines.join(" ")).toContain("48K");
  }
  const stale: GuardRow = { ...row, ...metric(row.snapshot, 400000, 300000) };
  expect(mainLines(stale, 35, 399000).join(" ")).toContain("STALE");
  expect(mainLines(stale, 35, 399000).join(" ")).toContain("112K");
  const invalid: GuardRow = {
    ...row,
    ...metric({ ...row.snapshot, model: "other" }, 4000, 300000),
  };
  expect(mainLines(invalid, 35, 3000).join(" ")).not.toContain("112K");
  const missing: GuardRow = {
    node: row.node,
    current: true,
    depth: 0,
    hidden: 0,
    freshness: "missing",
    pressure: "unknown",
  };
  expect(mainLines(missing, 35, 0).join(" ")).toContain("not monitored");
  expect(progress(undefined, 16)).toContain("?%");
  expect(progress(1.2, 16)).toBe("███████████ 120%");
  expect(progress(0, 16)).toBe("░░░░░░░░░░░░░ 0%");
});

test("narrow agent rows preserve names and separate execution from pressure", () => {
  const row = sidebarFamily()[1];
  if (!row) throw new Error("Missing fixture");
  expect(agentHeading(row, 14)).toContain("explore");
  expect(agentLines(row, 14).join(" ")).toContain("RUNNING");
  expect(agentLines(row, 14).join(" ")).toContain("CRITICAL");
  const failed = { ...row, node: { ...row.node, status: "failed" as const } };
  expect(agentHeading(failed, 14)).toStartWith("✕");
  expect(agentLines(failed, 14).join(" ")).toContain("FAILED");
});

test("subagent tree scopes descendants, preserves parents and prioritizes active branches", () => {
  const rows = sidebarFamily();
  const tree = subagentTree(rows, "main", new Set(), false, true);
  expect(tree.visible.map((entry) => entry.row.node.sessionId)).toEqual([
    "explore",
    "indexer",
    "implementor",
    "reviewer",
  ]);
  expect(
    subagentTree(rows, "explore", new Set(), false, true).all.map(
      (row) => row.node.sessionId,
    ),
  ).toEqual(["indexer"]);
  const folded = subagentTree(rows, "main", new Set(["explore"]), false, true);
  expect(folded.all).toHaveLength(4);
  expect(folded.visible.map((entry) => entry.row.node.sessionId)).not.toContain(
    "indexer",
  );
  const completedParent = rows.map((row) =>
    row.node.sessionId === "explore"
      ? { ...row, node: { ...row.node, status: "completed" as const } }
      : row,
  );
  expect(
    subagentTree(completedParent, "main", new Set(), true, true).visible.map(
      (entry) => entry.row.node.sessionId,
    ),
  ).toEqual(["explore", "indexer", "implementor"]);
  // Sorting only changes siblings; a child remains adjacent to its parent.
  const reversed = [...rows].reverse();
  expect(
    subagentTree(reversed, "main", new Set(), false, false).visible.map(
      (entry) => entry.row.node.sessionId,
    ),
  ).toEqual(["implementor", "explore", "indexer", "reviewer"]);
  expect(
    subagentTree(reversed, "main", new Set(), false, true).visible.map(
      (entry) => entry.row.node.sessionId,
    ),
  ).toEqual(["explore", "indexer", "implementor", "reviewer"]);
});

test("statistics aggregate independent observed peaks and do not invent unavailable totals", () => {
  const rows = sidebarFamily();
  const text = statistics(rows, "main", true, 35).join(" ");
  expect(text).toMatch(/Compactions +4/);
  expect(text).toMatch(/Active subagents +3/);
  expect(text).toMatch(/Family peaks \(sum\) +1M/);
  expect(statistics(rows, "main", false, 35).join(" ")).toMatch(
    /Compactions +\?/,
  );
  const unknown = rows.map((row) => {
    const { snapshot: _snapshot, ...rest } = row;
    return rest;
  });
  expect(statistics(unknown, "main", true, 35).join(" ")).toMatch(
    /Family peaks \(sum\) +\?/,
  );
});

test("native sidebar matches the reviewed frame and supports reactive controls", async () => {
  const process = Bun.spawn(
    [
      "bun",
      "--preload",
      "@opentui/solid/preload",
      "tests/fixtures/sidebar-host.tsx",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, UPDATE_SIDEBAR_FRAME: "0" },
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("PASS: sidebar layout");
});
