import { testRender } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import { createSignal } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { KeymapLayer } from "@opencode/plugin/tui/context";
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
const state = {
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
const color = RGBA.fromHex("#ffffff");
const context = {
  app: { version: "2.0.29" },
  theme: {
    text: {
      base: color,
      muted: color,
      feedback: {
        error: { base: color },
        warning: { base: color },
        success: { base: color },
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
try {
  await host.renderOnce();
  await host.renderOnce();
  assert.equal(consumers, 1);
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
    measurement: { ...before.snapshot.measurement, tokens: 144000 },
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
  assert.match(frame(), /awaiting-measurement/);
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
  "PASS: sidebar layout, reactive metrics/width/session, filters, grouping, navigation and cleanup",
);
