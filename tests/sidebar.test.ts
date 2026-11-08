import { expect, test } from "bun:test";
import {
  agentHeading,
  agentLines,
  mainLines,
  historySections,
  routeFamily,
  progress,
  statistics,
  subagentTree,
} from "../src/tui/compactformat.ts";
import { cells, rowLines, detailLines } from "../src/tui/format.ts";
import { metric, type GuardRow } from "../src/family.ts";
import { sidebarFamily } from "./fixtures/sidebar.ts";

test("sidebar preserves occupancy and threshold text with a capacity-scaled chart, unknown and stale measurements", () => {
  const row = sidebarFamily()[0];
  expect(row).toBeDefined();
  if (!row?.snapshot) throw new Error("Missing fixture");
  for (const width of [16, 20, 35, 80]) {
    const lines = mainLines(row, width, 3000);
    expect(lines.every((line) => cells(line) <= width)).toBe(true);
    expect(lines.join(" ")).toContain("22%");
    expect(lines.join(" ")).not.toContain("recent samples");
    expect(lines.join(" ")).toContain("48K");
    const history = historySections(row, width, 3000, [
      { at: 1000, tokens: 112000, held: true },
    ]).flatMap((section) => section.lines);
    expect(history.every((line) => cells(line) <= width)).toBe(true);
    expect(history.join(" ")).toContain("70%");
    expect(history.join(" ")).toContain("100%");
    expect(history.join(" ")).toContain("┄");
    expect(history.join(" ")).toContain("Dim = last known context");
  }
  const stale: GuardRow = { ...row, ...metric(row.snapshot, 400000, 300000) };
  expect(mainLines(stale, 35, 399000).join(" ")).toContain("out of date");
  const staleText = mainLines(stale, 35, 399000).join(" ");
  expect(staleText).toContain("112K");
  expect(staleText).toContain("Last measured");
  expect(staleText).toContain("pressure unknown");
  expect(staleText).not.toContain("48K tokens below");
  expect(staleText).not.toContain("70% of threshold");
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
  expect(agentLines(row, 14).join(" ")).toContain("82%");
  expect(agentLines(row, 14).join(" ")).toContain("Threshold reached");
  const failed = { ...row, node: { ...row.node, status: "failed" as const } };
  expect(agentHeading(failed, 14)).toStartWith("✕");
  expect(agentLines(failed, 14).join(" ")).toContain("FAILED");
});

test("subagent bars use measured capacity occupancy and preserve unknown and over-capacity values", () => {
  const row = sidebarFamily()[1];
  if (!row) throw new Error("Missing fixture");
  const { utilizationPercent: _utilizationPercent, ...unknown } = row;
  for (const width of [14, 16, 29, 35]) {
    expect(agentLines(row, width)[0]).toBe(progress(0.82, width));
    expect(agentLines({ ...row, freshness: "stale" }, width)[0]).toBe(
      progress(0.82, width),
    );
    for (const freshness of ["missing", "invalid"] as const)
      expect(agentLines({ ...row, freshness }, width)[0]).toBe(
        progress(undefined, width),
      );
    expect(agentLines(unknown, width)[0]).toBe(progress(undefined, width));
    expect(agentLines({ ...row, utilizationPercent: 120 }, width)[0]).toBe(
      progress(1.2, width),
    );
  }
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

test("performance labels preserve estimates, independent averages and partial timing in narrow rows", () => {
  const original = sidebarFamily()[0];
  if (!original?.snapshot) throw new Error("Missing fixture");
  const row: GuardRow = {
    ...original,
    snapshot: {
      ...original.snapshot,
      performance: {
        sessionCreatedAt: 1000,
        observedSince: 1000,
        at: 2000,
        status: "streaming",
        partial: true,
        liveTps: 12.3,
        averageModelTps: 45,
        averageSessionTps: 2,
        ttftMs: 200,
        estimatedOutputTokens: 12.3,
        modelOutputTokens: 45,
        modelDurationMs: 1000,
        completedRequests: 1,
        tokenSource: "estimated",
      },
    },
  };
  for (const width of [16, 20, 35, 80]) {
    const lines = [...rowLines(row, width), ...detailLines(row, width, true)];
    expect(lines.every((line) => cells(line) <= width)).toBe(true);
    const text = lines.join(" ");
    expect(text).toContain("~12.3");
    expect(text).toContain("partial");
    expect(text).toContain("Avg model 45.0");
    expect(text).toContain("TTFT ~0.20s");
  }
});

test("completed grouping requires a trustworthy inventory and preserves every attention state", () => {
  const rows = sidebarFamily();
  const base = rows.at(-1);
  if (!base?.snapshot) throw new Error("Missing fixture");
  const snapshot = base.snapshot;
  const visible = (row: GuardRow, trustworthy = true) =>
    subagentTree(
      [...rows.slice(0, -1), row],
      "main",
      new Set(),
      true,
      true,
      trustworthy,
    );
  expect(visible(base).grouped).toBe(1);
  expect(
    visible(base).visible.some((r) => r.row.node.sessionId === "reviewer"),
  ).toBe(false);
  expect(visible(base, false).grouped).toBe(0);
  const variants: GuardRow[] = [
    { ...base, freshness: "stale" },
    { ...base, freshness: "missing" },
    { ...base, freshness: "invalid" },
    { ...base, pressure: "near" },
    { ...base, pressure: "crossed" },
    { ...base, pressure: "unknown" },
    { ...base, hidden: 1 },
    { ...base, node: { ...base.node, interrupted: true } },
    ...(["running", "failed", "idle", "unknown"] as const).map((status) => ({
      ...base,
      node: { ...base.node, status },
    })),
    ...(
      [
        "requesting",
        "accepted",
        "running",
        "awaiting-measurement",
        "blocked",
        "uncertain",
      ] as const
    ).map((phase) => ({
      ...base,
      snapshot: { ...snapshot, compaction: { ...snapshot.compaction, phase } },
    })),
  ];
  const { snapshot: _snapshot, ...unmonitored } = base;
  variants.push(unmonitored);
  for (const row of variants) {
    expect(visible(row).grouped).toBe(0);
    expect(
      visible(row).visible.some((r) => r.row.node.sessionId === "reviewer"),
    ).toBe(true);
  }
});

test("grouping restores completed hierarchy and folding reports hidden attention without changing totals", () => {
  const original = sidebarFamily();
  const rows = original.map((r) => ({
    ...r,
    node: { ...r.node, status: "completed" as const },
    pressure: "normal" as const,
  }));
  const grouped = subagentTree(rows, "main", new Set(), true, true);
  expect(grouped.grouped).toBe(4);
  expect(grouped.visible).toHaveLength(0);
  const expanded = subagentTree(rows, "main", new Set(), false, true);
  expect(expanded.visible.map((r) => [r.row.node.sessionId, r.depth])).toEqual([
    ["explore", 0],
    ["indexer", 1],
    ["implementor", 0],
    ["reviewer", 0],
  ]);
  const attention = rows.map((r) =>
    r.node.sessionId === "indexer" ? { ...r, pressure: "near" as const } : r,
  );
  const folded = subagentTree(
    attention,
    "main",
    new Set(["explore"]),
    true,
    true,
  );
  expect(folded.all).toHaveLength(4);
  expect(folded.grouped).toBe(2);
  expect(folded.visible[0]).toMatchObject({ hidden: 1, attention: true });
  expect(routeFamily(rows, "main").rows).toHaveLength(5);
  expect(
    routeFamily(rows, "explore").rows.map((r) => r.node.sessionId),
  ).toEqual(["explore", "indexer"]);
});

test("sidebar grouping deduplicates IDs and retains uncertain ancestry at cycles and depth limits", () => {
  const base = sidebarFamily().at(-1);
  if (!base) throw new Error("Missing fixture");
  const chain = Array.from(
    { length: 70 },
    (_, i): GuardRow => ({
      ...base,
      node: {
        ...base.node,
        sessionId: `s${i}`,
        parentId: i ? `s${i - 1}` : "main",
      },
    }),
  );
  const tree = subagentTree(chain, "main", new Set(), true, true);
  expect(tree.complete).toBe(false);
  expect(tree.visible.length).toBeGreaterThan(0);
  expect(tree.grouped).toBe(0);
  const duplicate = subagentTree(
    [...sidebarFamily(), base],
    "main",
    new Set(),
    false,
    true,
  );
  expect(duplicate.all).toHaveLength(4);
  const cycle = subagentTree(
    [
      {
        ...base,
        node: { ...base.node, sessionId: "main", parentId: "reviewer" },
      },
      base,
    ],
    "main",
    new Set(),
    true,
    true,
  );
  expect(cycle.complete).toBe(false);
  expect(cycle.grouped).toBe(0);
  expect(cycle.visible).toHaveLength(1);
});

test("compact descendant rows fit ordinary sidebar budgets and keep stale, estimate and lifecycle qualifiers", () => {
  const rows = sidebarFamily();
  for (const [index, width] of [
    [1, 29],
    [2, 27],
    [3, 29],
  ] as const) {
    const row = rows[index];
    if (!row) throw new Error("Missing fixture");
    expect(agentLines(row, width)).toHaveLength(2);
    expect(agentLines(row, width).every((line) => cells(line) <= width)).toBe(
      true,
    );
  }
  const base = rows[1];
  if (!base?.snapshot?.measurement) throw new Error("Missing fixture");
  const row: GuardRow = {
    ...base,
    freshness: "stale",
    snapshot: {
      ...base.snapshot,
      measurement: { ...base.snapshot.measurement, confidence: "approximate" },
      compaction: { ...base.snapshot.compaction, phase: "uncertain" },
    },
  };
  const text = agentLines(row, 16).join(" ");
  expect(text).toContain("Last measured ~82%");
  expect(text).toContain("pressure unknown");
  expect(text).toContain("automatic retry suppressed");
  expect(text).not.toContain("Threshold reached");
  for (const name of ["研究助手", "👩‍💻build", "same name", "a".repeat(100)])
    expect(
      cells(agentHeading({ ...base, node: { ...base.node, agent: name } }, 10)),
    ).toBeLessThanOrEqual(10);
});
