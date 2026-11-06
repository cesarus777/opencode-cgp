// Executed with the public OpenTUI Solid preload in an isolated Bun process.
import { testRender } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import type { Plugin } from "@opencode/plugin/tui";
import type { KeymapLayer } from "@opencode/plugin/tui/context";
import { ContextTraceStore } from "../../src/tui/contextchart.ts";
import type { GuardState } from "../../src/tui/state.ts";
import type { MonitorHealth } from "../../src/snapshot.ts";
import type { Connection } from "../../src/tui/transport.ts";
import { metric } from "../../src/family.ts";
import type { GuardRow } from "../../src/family.ts";
import { GuardPanel } from "../../src/tui/panel.tsx";
import { sidebarFamily } from "./sidebar.ts";
import { createSignal } from "solid-js";
import assert from "node:assert/strict";

const [sessionID, setSessionID] = createSignal("s0");
const [width, setWidth] = createSignal(40);
const [focused, setFocused] = createSignal(true);
let acquisitions = 0,
  consumers = 0,
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
const chartSnapshot = sidebarFamily()[0]?.snapshot;
assert.ok(chartSnapshot);
const firstRow = family[0];
assert.ok(firstRow);
const [health, setHealth] = createSignal<MonitorHealth>({
  enabled: true,
  mode: "observe",
  enforcement: "observing",
  reasons: [],
  staleMs: 300000,
  maxSessions: 1024,
});
let refreshes = 0,
  loads = 0;
const [shortcutOverrides, setShortcutOverrides] = createSignal<
  Record<string, string[]>
>({});
const [complete, setComplete] = createSignal(true);
const [connection, setConnection] = createSignal<Connection>("live");
let holdHistory = false,
  historyAborts = 0;
const historyReads: { sessionId: string; windowMs: number }[] = [];
const traceStore = new ContextTraceStore();
const state: GuardState = {
  contextTrace: (row: Parameters<ContextTraceStore["update"]>[0]) =>
    traceStore.update(row),
  version: () => 0,
  history: async (id, from, to, signal) => {
    if (holdHistory)
      return new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            historyAborts++;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
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
    acquisitions++;
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
  health,
  connection,
  complete,
  inventoryStatus: () => ({
    discovered: family.length,
    limit: 1024,
    scanning: false,
    failed: false,
    damaged: false,
    pending: complete() ? 0 : 1,
    pages: 1,
    complete: complete(),
    canLoadMore: !complete(),
  }),
  refresh() {
    refreshes++;
  },
  loadMore() {
    loads++;
  },
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
    shortcuts(id: string) {
      const override = shortcutOverrides()[id];
      if (override) return override;
      const bind = layer?.().commands?.find((c) => c.id === id)?.bind;
      if (typeof bind !== "string") return [];
      const aliases: Record<string, string> = {
        up: "↑",
        down: "↓",
        left: "←",
        right: "→",
        return: "Enter",
        pageup: "pgup",
        pagedown: "pgdn",
      };
      return [aliases[bind] ?? bind];
    },
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
  await host.flush();
  assert.equal(consumers, 1);
  assert.match(host.captureCharFrame(), /Context Guard/);
  assert.ok(
    host
      .captureCharFrame()
      .split("\n")
      .some((line) => line.startsWith("  Live · Context Guard")),
    "panel has horizontal padding",
  );
  assert.match(host.captureCharFrame(), /q close/);
  assert.doesNotMatch(host.captureCharFrame(), /100%│|Provenance|Cumulative/);
  const run = (id: string) => {
    const command = layer?.().commands?.find((command) => command.id === id);
    assert.ok(command);
    return command.run();
  };
  for (let i = 0; i < 120; i++) run("context-guard.next");
  await host.flush();
  assert.match(host.captureCharFrame(), /agent120/);
  assert.ok(
    host
      .captureCharFrame()
      .split("\n")
      .some((line) => line.includes("agent120") && line.includes(">")),
    "selected row remains visible after windowing",
  );
  assert.doesNotMatch(host.captureCharFrame(), /agent0 RUN/);
  assert.match(
    host.captureCharFrame(),
    /q close/,
    "close hint stays visible after scrolling",
  );
  host.resize(40, 28);
  run("context-guard.charts");
  await Bun.sleep(5);
  await host.flush();
  assert.match(host.captureCharFrame(), /Performance charts/);
  assert.match(host.captureCharFrame(), /Live TPS/);
  assert.doesNotMatch(host.captureCharFrame(), /Avg model/);
  assert.match(host.captureCharFrame(), /\? help q close c back i details/);
  assert.match(host.captureCharFrame(), /←\/→ metric/);
  const readsBeforeMetric = historyReads.length;
  run("context-guard.chart-next");
  await host.flush();
  assert.match(host.captureCharFrame(), /Avg model/);
  assert.doesNotMatch(host.captureCharFrame(), /Live TPS/);
  assert.equal(
    historyReads.length,
    readsBeforeMetric,
    "metric changes reuse retained history",
  );
  run("context-guard.chart-previous");
  run("context-guard.chart-previous");
  await host.flush();
  assert.match(host.captureCharFrame(), /Cumulative output/);
  run("context-guard.chart-next");
  assert.equal(consumers, 1);
  assert.equal(historyReads.at(-1)?.sessionId, "s120");
  assert.equal(
    acquisitions,
    1,
    "view switches do not reacquire the panel consumer",
  );
  // Help owns input, aborts chart work, and returns to the same session/metric/window.
  holdHistory = true;
  run("context-guard.refresh");
  await host.flush();
  const beforeHelpRefreshes = refreshes;
  const beforeHelpReads = historyReads.length;
  run("context-guard.help");
  await host.flush();
  assert.equal(historyAborts, 1);
  assert.match(host.captureCharFrame(), /Native OpenCode panel/);
  for (const name of [
    "refresh",
    "load-more",
    "open",
    "inspect",
    "charts",
    "expand",
    "chart-next",
  ])
    run(`context-guard.${name}`);
  assert.equal(refreshes, beforeHelpRefreshes);
  assert.equal(historyReads.length, beforeHelpReads);
  run("context-guard.last");
  await host.flush();
  assert.match(host.captureCharFrame(), /End of native panel help/);
  run("context-guard.first");
  await host.flush();
  assert.match(host.captureCharFrame(), /Native OpenCode panel/);
  holdHistory = false;
  run("context-guard.help-back");
  await host.flush();
  assert.match(host.captureCharFrame(), /Performance charts/);
  assert.match(host.captureCharFrame(), /Live TPS/);
  assert.equal(historyReads.at(-1)?.sessionId, "s120");
  assert.equal(historyReads.at(-1)?.windowMs, 3600000);
  assert.equal(consumers, 1);
  run("context-guard.chart-longer");
  await Bun.sleep(5);
  await host.flush();
  assert.equal(historyReads.at(-1)?.windowMs, 86400000);
  run("context-guard.charts");
  await host.flush();
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
  await host.flush();
  assert.match(host.captureCharFrame(), /agent3/);
  setFocused(false);
  const enabled = layer?.().enabled;
  assert.equal(typeof enabled === "function" ? enabled() : enabled, false);
} finally {
  host.renderer.destroy();
}
assert.equal(consumers, 0);
setSessionID("s0");
setWidth(40);
setFocused(true);
const root: GuardRow = {
  ...firstRow,
  node: { ...firstRow.node, agent: "Main", model: "deepseek-flash" },
  snapshot: { ...chartSnapshot, sessionId: "s0" },
  ...metric(chartSnapshot, 4000, 300000),
};
const childSnapshot = {
  ...chartSnapshot,
  sessionId: "child",
  parentId: "s0",
  agent: "explore",
};
const child: GuardRow = {
  ...root,
  node: {
    sessionId: "child",
    parentId: "s0",
    agent: "explore",
    status: "running",
  },
  snapshot: childSnapshot,
  current: false,
  depth: 1,
};
const [chartRows, setChartRows] = createSignal<GuardRow[]>([root, child]);
Object.assign(context, { renderer: undefined });
const chartHost = await testRender(
  () => (
    <GuardPanel
      input={input}
      context={context}
      state={{ ...state, rows: chartRows }}
    />
  ),
  { width: 40, height: 20 },
);
Object.assign(context, { renderer: chartHost.renderer });
const run = (id: string) => {
  const command = layer?.().commands?.find((command) => command.id === id);
  assert.ok(command);
  command.run();
};
try {
  await chartHost.flush();
  let frame = chartHost.captureCharFrame();
  assert.match(frame, /Selected: Main/);
  assert.match(frame, /112K\/500K/);
  assert.match(frame, /48K tokens below/);
  assert.match(frame, /explore/);
  assert.doesNotMatch(frame, /100%│|Provenance|Cumulative/);
  assert.equal(consumers, 1);
  // Footer actions are independent mouse targets, sharing the keyboard transitions.
  const clickAction = async (label: string) => {
    const lines = chartHost.captureCharFrame().split("\n");
    const y = lines.findIndex((line) => line.includes(label));
    assert.ok(y >= 0);
    const x = lines[y]?.indexOf(label) ?? -1;
    assert.ok(x >= 0);
    await chartHost.mockMouse.click(x + 1, y);
    await chartHost.flush();
  };
  await clickAction("c charts");
  assert.match(chartHost.captureCharFrame(), /Performance charts/);
  await clickAction("i details");
  assert.match(chartHost.captureCharFrame(), /Context history/);
  await clickAction("i back");
  assert.match(chartHost.captureCharFrame(), /Selected: Main/);
  // Inspecting the current session is now an explicit view with keyboard reachability.
  run("context-guard.inspect");
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Context history/);
  run("context-guard.last");
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Native Context uses different/);
  const beforeDetailsHelp = chartHost.captureCharFrame();
  run("context-guard.help");
  await chartHost.flush();
  run("context-guard.last");
  await chartHost.flush();
  run("context-guard.help");
  await chartHost.flush();
  assert.equal(
    chartHost.captureCharFrame(),
    beforeDetailsHelp,
    "Details scroll is restored",
  );
  run("context-guard.first");
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Context history/);
  run("context-guard.inspect");
  run("context-guard.next");
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Selected: explore/);
  run("context-guard.inspect");
  await chartHost.flush();
  run("context-guard.last");
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Main \/ explore/);
  run("context-guard.charts");
  await Bun.sleep(5);
  await chartHost.flush();
  assert.equal(historyReads.at(-1)?.sessionId, "child");
  run("context-guard.charts");
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Selected: explore/);
  assert.equal(consumers, 1, "view switches preserve one consumer");
  assert.equal(acquisitions, 2);
  // Value/order changes preserve identity; removal falls back to the route session.
  setChartRows([child, root]);
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Selected: explore/);
  setChartRows([root]);
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Selected: Main/);
  setChartRows([]);
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /No sessions/);
  closed = false;
  run("context-guard.open");
  assert.equal(closed, false, "empty family cannot navigate");
  setChartRows([root, child]);
  // Conditional load-more and refresh actions retain their existing state ports.
  run("context-guard.load-more");
  assert.equal(loads, 0);
  setComplete(false);
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /partial/);
  assert.match(chartHost.captureCharFrame(), /l more/);
  run("context-guard.load-more");
  assert.equal(loads, 1);
  run("context-guard.refresh");
  assert.equal(refreshes, 2);
  setComplete(true);
  // Critical enforcement state remains visible through every view and refresh.
  setHealth({
    ...health(),
    enforcement: "suspended",
    reasons: ["event-stream-gap"],
  });
  await chartHost.flush();
  assert.match(
    chartHost.captureCharFrame(),
    /Guard suspended · reload required/,
  );
  run("context-guard.inspect");
  await chartHost.flush();
  assert.match(
    chartHost.captureCharFrame(),
    /Guard suspended · reload required/,
  );
  run("context-guard.inspect");
  setHealth({ ...health(), enforcement: "observing", reasons: [] });
  // Use the measured container height, including a tiny terminal fallback.
  for (const [w, h] of [
    [80, 24],
    [40, 20],
    [20, 12],
  ]) {
    setWidth(w ?? 40);
    chartHost.resize(w ?? 40, h ?? 20);
    await chartHost.flush();
    await chartHost.flush();
    frame = chartHost.captureCharFrame();
    assert.match(frame, /q close/);
    assert.match(frame, /\? help/);
    assert.match(frame, /Main/);
    assert.match(frame, /explore/, `family remains visible at ${w}×${h}`);
    run("context-guard.help");
    await chartHost.flush();
    assert.match(chartHost.captureCharFrame(), /Native OpenCode/);
    assert.match(chartHost.captureCharFrame(), /q close/);
    run("context-guard.last");
    await chartHost.flush();
    assert.match(
      chartHost.captureCharFrame().replace(/\s+/g, " "),
      /native panel help/,
    );
    run("context-guard.help-back");
    await chartHost.flush();
    assert.match(chartHost.captureCharFrame(), /Main/);
  }
  // A UI reconnect keeps server suspension explicit at each supported geometry.
  for (const reasons of [["event-stream-gap"], ["persistence-unavailable"]]) {
    setHealth({ ...health(), enforcement: "suspended", reasons });
    for (const nextConnection of ["reconnecting", "live"] as const) {
      setConnection(nextConnection);
      for (const [w, h] of [
        [80, 24],
        [40, 20],
        [20, 12],
      ]) {
        setWidth(w ?? 40);
        chartHost.resize(w ?? 40, h ?? 20);
        await chartHost.flush();
        await chartHost.flush();
        const text = chartHost
          .captureCharFrame()
          .split("\n")
          .map((line) => line.trim())
          .join(" ");
        assert.match(text, /Guard suspended/);
        assert.match(text.toLowerCase(), /reload/);
        assert.match(text, /Main/);
        assert.match(text, /q close/);
        if (nextConnection === "reconnecting") {
          assert.match(text, /Reconnecting/);
          assert.match(text, /Last known/);
        }
        if (reasons.includes("persistence-unavailable"))
          assert.match(text.toLowerCase(), /repair/);
        run("context-guard.help");
        await chartHost.flush();
        const helpText = chartHost.captureCharFrame().replace(/\s+/g, " ");
        assert.match(helpText, /Guard suspended/);
        assert.match(helpText.toLowerCase(), /reload/);
        assert.match(helpText, /q close/);
        run("context-guard.help-back");
        await chartHost.flush();
      }
    }
  }
  run("context-guard.next");
  run("context-guard.help");
  setChartRows([root]);
  await chartHost.flush();
  run("context-guard.help-back");
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /Main/);
  setChartRows([root, child]);
  run("context-guard.help");
  setSessionID("child");
  await chartHost.flush();
  assert.doesNotMatch(chartHost.captureCharFrame(), /Native OpenCode/);
  assert.match(chartHost.captureCharFrame(), /explore/);
  setSessionID("s0");
  await chartHost.flush();
  setShortcutOverrides({
    "context-guard.help": ["ctrl+x shift+alt+?"],
    "context-guard.close": [],
    "context-guard.inspect": ["F9"],
  });
  setWidth(20);
  chartHost.resize(20, 12);
  await chartHost.flush();
  assert.match(chartHost.captureCharFrame(), /help close/);
  run("context-guard.help");
  run("context-guard.last");
  await chartHost.flush();
  run("context-guard.help-back");
  setShortcutOverrides({});
  setConnection("live");
  setHealth({ ...health(), enforcement: "observing", reasons: [] });
  setWidth(40);
  chartHost.resize(40, 50);
  run("context-guard.inspect");
  await chartHost.flush();
  const initialFrame = chartHost.captureCharFrame().split("\n");
  const chartTop = initialFrame.findIndex((line) => line.includes("100%│"));
  assert.ok(chartTop >= 0);
  const chartEnd = initialFrame[chartTop]?.lastIndexOf("│") ?? -1;
  assert.ok(chartEnd > 10, "right chart edge fits before the scrollbar");
  assert.equal(
    initialFrame[chartTop + 8]?.[chartEnd],
    "┘",
    "chart uses nine rows without line wrapping",
  );
  assert.equal(consumers, 1);
} finally {
  chartHost.renderer.destroy();
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
  options: { openShortcut: "<leader>v" },
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
setShortcutOverrides({ "context-guard.show": ["ctrl+x v"] });
const defaultUnload = await entry.setup({ ...activationContext, options: {} });
assert.equal(
  layer?.().commands?.find((c) => c.id === "context-guard.show")?.bind,
  undefined,
);
if (typeof defaultUnload === "function") await defaultUnload();
assert.equal(registrations, 0);
for (const invalid of ["", "   ", "x".repeat(129), "x\ny", 4]) {
  assert.throws(
    () =>
      entry.setup({ ...activationContext, options: { openShortcut: invalid } }),
    /openShortcut/,
  );
}
const unload = await entry.setup(activationContext);
assert.equal(layer?.().mode, "global");
assert.equal(
  layer?.().commands?.find((c) => c.id === "context-guard.show")?.bind,
  "<leader>v",
);
assert.equal(registrations, 3);
assert.ok(renderChildAction);
const actionHost = await testRender(renderChildAction, {
  width: 40,
  height: 4,
});
try {
  await actionHost.renderOnce();
  assert.match(actionHost.captureCharFrame(), /Context Guard: open panel/);
  assert.match(actionHost.captureCharFrame(), /ctrl\+x v/);
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
