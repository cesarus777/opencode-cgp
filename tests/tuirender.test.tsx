import { test, expect } from "bun:test";
import { clip, cells, detailLines, rowLines } from "../src/tui/format.ts";
import { metric, type GuardRow } from "../src/family.ts";
import type { ContextSnapshot } from "../src/snapshot.ts";
const snapshot: ContextSnapshot = {
  sessionId: "s",
  revision: 1,
  observedAt: 100,
  agent: "研究助手",
  model: "local/deepseek",
  measurement: {
    tokens: 96000,
    at: 100,
    model: "local/deepseek",
    confidence: "reported",
    provenance: "provider-normalized",
    scope: "completed-request",
  },
  capacityTokens: 128000,
  policy: {
    id: "defaults",
    configured: { type: "tokens", value: 100000 },
    triggerTokens: 100000,
    comparison: ">=",
    reason: "below-threshold",
    crossed: false,
  },
  compaction: { phase: "accepted", armed: false },
  cumulativeScope: "unknown",
  lastObservedActive: true,
};
const row: GuardRow = {
  node: { sessionId: "s", agent: "研究助手", status: "running" },
  snapshot,
  depth: 1,
  current: true,
  hidden: 0,
  ...metric(snapshot, 100, 1000),
};
test("layout retains required quantities and status without color at 20/35/80 cells", () => {
  for (const width of [20, 35, 80]) {
    const lines = detailLines(row, width, true);
    expect(lines.every((line) => cells(line) <= width)).toBe(true);
    const text = lines.join(" ");
    for (const value of [
      "96.0k",
      "128.0k",
      "75.0%",
      "100000",
      "4.0k",
      "accepted",
      "reported",
      "completed-request",
    ])
      expect(text).toContain(value);
  }
  expect(rowLines(row, 35).join(" ")).toContain("RUN");
  expect(rowLines(row, 35).join(" ")).toContain("near");
});
test("clip respects graphemes, CJK, emoji and strips terminal controls", () => {
  for (const text of ["研究助手abc", "👩‍💻build", "évaluation", "a\x1b[31mb"])
    for (const width of [1, 2, 5, 10])
      expect(cells(clip(text, width))).toBeLessThanOrEqual(width);
  expect(clip("👩‍💻ok", 8)).toBe("👩‍💻ok");
  expect(clip("a\n\rb", 10)).toBe("ab");
});

test("public Solid preload renders the native panel and preserves navigation and cleanup", async () => {
  const process = Bun.spawn(
    [
      "bun",
      "--preload",
      "@opentui/solid/preload",
      "tests/fixtures/tui-host.tsx",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("PASS: native renderer");
});
