import { testRender } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import { createSignal } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { KeymapLayer } from "@opencode/plugin/tui/context";
import { ContextTraceStore } from "../../src/tui/contextchart.ts";
import type { GuardState } from "../../src/tui/state.ts";
import { GuardView } from "../../src/tui/sidebar.tsx";
import { metric } from "../../src/family.ts";
import { sidebarFamily } from "./sidebar.ts";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const [rows, setRows] = createSignal(sidebarFamily());
const [sessionID, setSessionID] = createSignal("main");
let consumers = 0,
  destination = "";
let layer: (() => KeymapLayer) | undefined;
const traceStore = new ContextTraceStore();
const state = {
  contextTrace: (row: Parameters<ContextTraceStore["update"]>[0]) =>
    traceStore.update(row),
  acquire: () => {
    consumers++;
    return {
      update() {},
      release() {
        consumers--;
      },
    };
  },
  rows,
  age: () => 3000,
  health: () => ({ mode: "observe", enforcement: "observing", reasons: [] }),
  connection: () => "live",
  complete: () => true,
} as unknown as GuardState;
const palette = {
  base: RGBA.fromHex("#ffffff"),
  muted: RGBA.fromHex("#777777"),
  success: RGBA.fromHex("#00ff00"),
  warning: RGBA.fromHex("#ffff00"),
  error: RGBA.fromHex("#ff0000"),
};
const context = {
  app: { version: "2.0.29" },
  theme: {
    text: {
      base: palette.base,
      muted: palette.muted,
      feedback: {
        error: { base: palette.error },
        warning: { base: palette.warning },
        success: { base: palette.success },
      },
    },
  },
  keymap: {
    layer(factory: () => KeymapLayer) {
      layer = factory;
    },
  },
  ui: {
    panel: { open() {} },
    router: {
      navigate(route: { sessionID: string }) {
        destination = route.sessionID;
      },
    },
  },
} as unknown as Plugin.Context;
const host = await testRender(
  () => (
    <GuardView
      sessionID={sessionID()}
      state={state}
      context={context}
      width={39}
    />
  ),
  { width: 39, height: 100 },
);
const frame = () =>
  host
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd() + "\n";
const run = (id: string) => {
  const command = layer?.().commands?.find((command) => command.id === id);
  assert.ok(command);
  command.run();
};
function assertColor(text: string, expected: RGBA, within?: string) {
  const lines = host.captureSpans().lines;
  const candidates = within
    ? lines.filter((line) =>
        line.spans
          .map((span) => span.text)
          .join("")
          .includes(within),
      )
    : lines;
  assert.ok(
    candidates.some((line) =>
      line.spans.some(
        (span) => span.text.includes(text) && span.fg.equals(expected),
      ),
    ),
    `Expected ${text} in ${expected.toString()}${within ? ` within ${within}` : ""}`,
  );
}
function assertMainChart(expected: RGBA) {
  const lines = host.captureSpans().lines;
  const end = lines.findIndex((line) =>
    line.spans.some((span) => span.text.includes("Compact threshold")),
  );
  const chart = lines.slice(0, end);
  assert.ok(
    chart.some((line) =>
      line.spans.some(
        (span) => /[▁▂▃▄▅▆▇█]/.test(span.text) && span.fg.equals(expected),
      ),
    ),
    "Context trace reflects current pressure",
  );
  assert.ok(
    chart.some((line) =>
      line.spans.some(
        (span) => span.text.includes("┄") && span.fg.equals(palette.warning),
      ),
    ),
    "Threshold has a separate warning color",
  );
}

try {
  await host.renderOnce();
  await host.renderOnce();
  assert.equal(consumers, 1);
  assertMainChart(palette.success);
  assertColor("RUNNING", palette.success, "Main");
  assertColor("●", palette.success, "explore");
  assertColor("explore", palette.error);
  assertColor("CRITICAL", palette.error);
  assertColor("indexer", palette.success);
  assertColor("implementor", palette.warning);
  assertColor("WARNING", palette.warning);
  assertColor("reviewer", palette.muted);
  const golden = new URL("./sidebar-frame.txt", import.meta.url);
  if (process.env.UPDATE_SIDEBAR_FRAME === "1") writeFileSync(golden, frame());
  assert.equal(frame(), readFileSync(golden, "utf8"));
  assert.match(frame(), /SUBAGENTS \(4\)/);
  assert.match(frame(), /3 running · 1 completed/);
  assert.match(frame(), /CRITICAL/);
  assert.match(frame(), /48K tokens until compaction/);
  const lines = frame().split("\n");
  const exploreY = lines.findIndex((line) => line.includes("● explore"));
  assert.ok(exploreY > 0);
  await host.mockMouse.click(9, exploreY);
  assert.equal(destination, "explore");
  // The group's disclosure control is separate from the session link.
  await host.mockMouse.click(2, exploreY);
  await host.renderOnce();
  assert.doesNotMatch(frame(), /indexer/);
  assert.match(frame(), /SUBAGENTS \(4\)/);
  run("context-guard.groups");
  await host.renderOnce();
  assert.match(frame(), /indexer/);
  run("context-guard.completed");
  await host.renderOnce();
  assert.doesNotMatch(frame(), /reviewer/);
  assert.match(frame(), /Show completed/);
  assert.match(frame(), /1 completed/);
  run("context-guard.completed");
  run("context-guard.sort");
  await host.renderOnce();
  assert.match(frame(), /Sort: activity/);
  const before = rows()[0];
  assert.ok(before?.snapshot?.measurement);
  const snapshot = {
    ...before.snapshot,
    measurement: { ...before.snapshot.measurement, at: 2000, tokens: 144000 },
    compaction: {
      ...before.snapshot.compaction,
      phase: "awaiting-measurement" as const,
    },
  };
  setRows([
    { ...before, snapshot, ...metric(snapshot, 4000, 300000) },
    ...rows().slice(1),
  ]);
  await host.renderOnce();
  assert.match(frame(), /144K \/ 500K/);
  assert.match(frame(), /90%/);
  assert.match(frame(), /recent samples → now/);
  assert.match(
    frame(),
    /██░│/,
    "new measurements keep the earlier sample and held tail",
  );
  assertMainChart(palette.warning);
  assert.match(frame(), /awaiting-measurement/);
  const nearRows = rows();
  const criticalSnapshot = {
    ...snapshot,
    measurement: { ...snapshot.measurement, at: 3000, tokens: 176000 },
  };
  setRows([
    {
      ...before,
      snapshot: criticalSnapshot,
      ...metric(criticalSnapshot, 4000, 300000),
    },
    ...nearRows.slice(1),
  ]);
  await host.renderOnce();
  assertMainChart(palette.error);
  assertColor("RUNNING", palette.success, "Main");
  const compacted = {
    ...criticalSnapshot,
    measurement: { ...criticalSnapshot.measurement, at: 4000, tokens: 20000 },
    compaction: { ...criticalSnapshot.compaction, lastCompleted: 3500 },
  };
  setRows([
    { ...before, snapshot: compacted, ...metric(compacted, 4000, 300000) },
    ...nearRows.slice(1),
  ]);
  await host.renderOnce();
  assert.match(frame(), /20K \/ 500K/);
  assertColor("┈", palette.muted);
  assert.match(
    frame(),
    /█▃┈│/,
    "post-compaction measurement drops while keeping history",
  );
  setRows([
    {
      ...before,
      snapshot: criticalSnapshot,
      ...metric(criticalSnapshot, 400000, 300000),
    },
    ...nearRows.slice(1),
  ]);
  await host.renderOnce();
  assertMainChart(palette.muted);
  assertColor("STALE", palette.warning);
  setRows([
    {
      ...before,
      node: { ...before.node, status: "failed" },
      snapshot: criticalSnapshot,
      ...metric(criticalSnapshot, 4000, 300000),
    },
    ...nearRows.slice(1),
  ]);
  await host.renderOnce();
  assertColor("FAILED", palette.error, "Main");
  setRows(nearRows);
  await host.renderOnce();
  host.resize(35, 100);
  await host.renderOnce();
  await host.renderOnce();
  assert.match(frame(), /Main/);
  assert.match(frame(), /RUNNING/);
  assert.match(frame(), /explore/);
  host.resize(20, 100);
  await host.renderOnce();
  await host.renderOnce();
  assert.match(frame(), /explore/);
  assert.match(frame(), /indexer/);
  assert.match(frame(), /CRITICAL/);
  assert.match(frame(), /STATISTICS/);
  assert.ok(
    frame()
      .split("\n")
      .filter((line) => line.includes("│"))
      .every((line) => line.startsWith("│") && line.endsWith("│")),
  );
  setSessionID("explore");
  await host.renderOnce();
  assert.match(frame(), /SUBAGENTS \(1\)/);
  assert.match(frame(), /indexer/);
  assert.doesNotMatch(frame(), /implementor/);
} finally {
  host.renderer.destroy();
}
assert.equal(consumers, 0);
console.log(
  "PASS: sidebar layout, rendered theme colors, reactive metrics/width/session, filters, grouping, navigation and cleanup",
);
