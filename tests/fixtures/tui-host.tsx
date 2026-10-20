// Executed with the public OpenTUI Solid preload in an isolated Bun process.
import { testRender } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import type { Plugin } from "@opencode/plugin/tui";
import type { KeymapLayer } from "@opencode/plugin/tui/context";
import type { GuardState } from "../../src/tui/state.ts";
import type { GuardRow } from "../../src/family.ts";
import { GuardPanel } from "../../src/tui/panel.tsx";
import { createSignal } from "solid-js";
import assert from "node:assert/strict";

const [sessionID, setSessionID] = createSignal("s0");
const [width, setWidth] = createSignal(40);
const [focused, setFocused] = createSignal(true);
let consumers = 0,
  closed = false,
  destination = "";
const family: GuardRow[] = Array.from({ length: 150 }, (_, i) => ({
  node: { sessionId: `s${i}`, agent: `agent${i}`, status: "running" },
  depth: i ? 1 : 0,
  current: i === 0,
  freshness: "missing",
  pressure: "unknown",
  hidden: 0,
}));
const historyReads: { sessionId: string; windowMs: number }[] = [];
const state: GuardState = {
  version: () => 0,
  history: async (id, from, to) => {
    historyReads.push({ sessionId: id, windowMs: to - from });
    return {
      schemaVersion: 1,
      generatedAt: to,
      enabled: true,
      truncated: false,
      metadata: {
        schema: 1,
        retainedBytes: 100,
        skippedBytes: 0,
        malformedRecords: 0,
        completeness: "bounded-retention",
      },
      data: {
        schema: 1,
        maxPoints: 240,
        omittedSessions: 0,
        gaps: [],
        series: [
          {
            sessionId: id,
            agents: ["build"],
            models: ["p/m"],
            points: [
              {
                time: to - 1000,
                liveTps: 10,
                averageModelTps: 15,
                partial: false,
                breakBefore: true,
              },
            ],
            requests: [],
            originalPoints: 1,
          },
        ],
      },
    };
  },
  acquire: () => {
    consumers++;
    return {
      update() {},
      release() {
        consumers--;
      },
    };
  },
  rows: () => family,
  dispose() {},
  age: () => 0,
  health: () => undefined,
  connection: () => "live",
  complete: () => true,
  refresh() {},
  loadMore() {},
  expand() {},
};
let layer: (() => KeymapLayer) | undefined;
// Only the public fields used by this component are needed by the renderer fixture.
const context = {
  app: { version: "2.0.29" },
  theme: {
    text: {
      base: RGBA.fromHex("#ffffff"),
      muted: RGBA.fromHex("#aaaaaa"),
      feedback: {
        warning: { base: RGBA.fromHex("#ffff00") },
        error: { base: RGBA.fromHex("#ff0000") },
      },
    },
  },
  keymap: {
    layer(factory: () => KeymapLayer) {
      layer = factory;
    },
  },
  ui: {
    panel: {
      close() {
        closed = true;
      },
      open() {},
    },
    router: {
      navigate(route: { sessionID: string }) {
        destination = route.sessionID;
      },
    },
  },
} as unknown as Plugin.Context;
const input = {
  name: "context-guard.monitor",
  get sessionID() {
    return sessionID();
  },
  get width() {
    return width();
  },
  presentation: "panel" as const,
  get focused() {
    return focused();
  },
  focus() {},
  close() {
    closed = true;
  },
  toggleFullscreen() {},
};
const host = await testRender(
  () => <GuardPanel input={input} context={context} state={state} />,
  { width: 40, height: 50 },
);
try {
  Object.assign(context, { renderer: host.renderer });
  await host.renderOnce();
  assert.equal(consumers, 1);
  assert.match(host.captureCharFrame(), /Context Guard/);
  assert.ok(
    host
      .captureCharFrame()
      .split("\n")
      .some((line) => line.startsWith("  Context Guard")),
    "panel has horizontal padding",
  );
  assert.match(host.captureCharFrame(), /q close/);
  const run = (id: string) => {
    const command = layer?.().commands?.find((command) => command.id === id);
    assert.ok(command);
    return command.run();
  };
  for (let i = 0; i < 120; i++) run("context-guard.next");
  await host.renderOnce();
  assert.match(host.captureCharFrame(), /agent120/);
  assert.doesNotMatch(host.captureCharFrame(), /agent0 RUN/);
  assert.match(
    host.captureCharFrame(),
    /q close/,
    "close hint stays visible after scrolling",
  );
  host.resize(40, 28);
  run("context-guard.charts");
  await Bun.sleep(5);
  await host.renderOnce();
  assert.match(host.captureCharFrame(), /Performance charts/);
  assert.match(host.captureCharFrame(), /Live TPS/);
  assert.doesNotMatch(host.captureCharFrame(), /Avg model/);
  assert.match(host.captureCharFrame(), /c back · q close/);
  assert.match(host.captureCharFrame(), /← \/ → metric/);
  const readsBeforeMetric = historyReads.length;
  run("context-guard.chart-next");
  await host.renderOnce();
  assert.match(host.captureCharFrame(), /Avg model/);
  assert.doesNotMatch(host.captureCharFrame(), /Live TPS/);
  assert.equal(
    historyReads.length,
    readsBeforeMetric,
    "metric changes reuse retained history",
  );
  run("context-guard.chart-previous");
  run("context-guard.chart-previous");
  await host.renderOnce();
  assert.match(host.captureCharFrame(), /Cumulative output/);
  run("context-guard.chart-next");
  assert.equal(consumers, 1);
  assert.equal(historyReads.at(-1)?.sessionId, "s120");
  run("context-guard.chart-longer");
  await Bun.sleep(5);
  await host.renderOnce();
  assert.equal(historyReads.at(-1)?.windowMs, 86400000);
  run("context-guard.charts");
  await host.renderOnce();
  assert.doesNotMatch(host.captureCharFrame(), /Performance charts/);
  run("context-guard.close");
  assert.equal(closed, true);
  closed = false;
  run("context-guard.open");
  assert.equal(destination, "s120");
  assert.equal(closed, true);
  setSessionID("s3");
  setWidth(20);
  host.resize(20, 50);
  await host.renderOnce();
  assert.match(host.captureCharFrame(), /agent3/);
  setFocused(false);
  const enabled = layer?.().enabled;
  assert.equal(typeof enabled === "function" ? enabled() : enabled, false);
} finally {
  host.renderer.destroy();
}
assert.equal(consumers, 0);
console.log(
  "PASS: native renderer, row window, reactive session/width, navigation and cleanup",
);

// Exercise the actual entry's child-route access, not a fixture-only command.
const { default: entry } = await import("../../src/tui.tsx");
let renderChildAction: (() => import("@opentui/solid").JSX.Element) | undefined;
let openedPanel = "",
  registrations = 0;
const activationContext = {
  ...context,
  client: { rpc: () => ({}) },
  data: { session: { get: () => ({ parentID: "parent" }) } },
  storage: { store: () => [{ expanded: [] }, async () => {}] },
  ui: {
    ...context.ui,
    panel: {
      ...context.ui.panel,
      open(name: string) {
        openedPanel = name;
        return true;
      },
    },
    slot(claim: import("@opencode/plugin/tui/context").SlotClaim) {
      registrations++;
      if (claim.append === "session.composer.top")
        renderChildAction = () => claim.render({ sessionID: "child" });
      return () => {
        registrations--;
      };
    },
  },
} as unknown as Plugin.Context;
const unload = await entry.setup(activationContext);
assert.equal(layer?.().mode, "global");
assert.equal(registrations, 3);
assert.ok(renderChildAction);
const actionHost = await testRender(renderChildAction, {
  width: 40,
  height: 4,
});
try {
  await actionHost.renderOnce();
  assert.match(actionHost.captureCharFrame(), /Context Guard: open panel/);
  await actionHost.mockMouse.click(4, 0);
  assert.equal(openedPanel, "context-guard.monitor");
} finally {
  actionHost.renderer.destroy();
  if (typeof unload === "function") await unload();
}
assert.equal(registrations, 0);
console.log(
  "PASS: child composer action opens the panel and cleans up its registrations",
);
