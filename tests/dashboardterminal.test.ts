import { test, expect, spyOn } from "bun:test";
import {
  parseDashboardArgs,
  checkTerminalRuntime,
} from "../src/dashboard/command.ts";
import { TerminalShell, mountTerminal } from "../src/dashboard/terminal.ts";
import {
  diagnosticRow,
  overviewLabels,
  overviewRowLines,
  terminalDetail,
  terminalHistory,
  snapshotFields,
} from "../src/dashboard/terminalview.ts";
import { cells } from "../src/tui/format.ts";
import { terminalFixture } from "./fixtures/dashboard-terminal.ts";

async function settle(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await Bun.sleep(1);
  }
  throw new Error("terminal fixture did not settle");
}

test("dashboard command validates mode/options and keeps server paths and credentials scoped", () => {
  expect(
    parseDashboardArgs(["tui"], "/local", {
      CONTEXT_GUARD_PASSWORD: "ignored",
    }),
  ).toEqual({ directory: "/local" });
  expect(
    parseDashboardArgs(["tui", "--directory", "child"], "/local", {}),
  ).toEqual({ directory: "/local/child" });
  expect(
    parseDashboardArgs(
      [
        "tui",
        "--server",
        "https://example.test",
        "--directory",
        "/server/../owning",
      ],
      "/local",
      { CONTEXT_GUARD_PASSWORD: "private" },
    ),
  ).toEqual({
    directory: "/server/../owning",
    server: "https://example.test",
    username: "opencode",
    password: "private",
  });
  expect(parseDashboardArgs(["tui", "--help"], "/local", {})).toBe("help");
  for (const args of [
    ["web"],
    ["tui", "--server"],
    ["tui", "--unknown", "secret"],
    ["tui", "--server", "https://example.test"],
    ["tui", "--directory", "/a", "--directory", "/b"],
  ])
    expect(() => parseDashboardArgs(args, "/local", {})).toThrow();
  expect(() => checkTerminalRuntime("1.1.34", true)).toThrow("Bun >=1.3.0");
  expect(() => checkTerminalRuntime("1.3.11", false)).toThrow("interactive");
  expect(() => checkTerminalRuntime("1.3.11", true)).not.toThrow();
});

test("terminal focus, identity selection, narrow layouts and history inspection share one stream", async () => {
  const { controller, counts } = terminalFixture();
  let quits = 0;
  const shell = new TerminalShell(controller, () => quits++);
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    shell.key({ name: "down" });
    const id = controller.getView().selectedSessionId;
    expect(id).toBe("child-a");
    await controller.refresh();
    expect(controller.getView().selectedSessionId).toBe(id);
    shell.key({ name: "/" });
    shell.key({ name: "q", sequence: "q" });
    shell.key({ name: "r", sequence: "r" });
    expect(quits).toBe(0);
    expect(shell.input).toBe("qr");
    shell.key({ name: "escape" });
    shell.key({ name: "f" });
    shell.paste("build");
    shell.key({ name: "return" });
    expect(shell.editor).toBe("model");
    shell.paste("synthetic/alpha");
    shell.key({ name: "return" });
    shell.key({ name: "3" });
    await settle(() => controller.getView().history.status === "ready");
    const reads = counts.history;
    for (let metric = 0; metric < 6; metric++) {
      shell.frame(80, 40);
      expect(
        terminalHistory(controller.getView(), 80, metric, 0).join(" "),
      ).not.toContain("NaN");
      shell.key({ name: "right" });
      shell.key({ name: "]" });
    }
    expect(counts.history).toBe(reads);
    expect(counts.streams).toBe(1);
    for (const width of [1, 8, 20, 35, 80, 160]) {
      for (const screen of ["1", "2", "3"]) {
        shell.key({ name: screen });
        const lines = shell.frame(width, 20).split("\n");
        expect(lines.length).toBeLessThanOrEqual(20);
        expect(lines.every((line) => cells(line) <= width)).toBe(true);
      }
    }
    shell.key({ name: "l" });
    shell.input = "relative";
    shell.key({ name: "return" });
    expect(shell.notice).toContain("absolute");
    shell.key({ name: "escape" });
    shell.key({ name: "q" });
    expect(quits).toBe(1);
  } finally {
    controller.stop();
  }
});

test("detail exposes all fields and unknown, stale, partial, blocked and uncertain labels", async () => {
  const { controller } = terminalFixture();
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    const row = controller.getView().selected;
    expect(row).toBeDefined();
    const detail = terminalDetail(row).join("\n");
    for (const field of snapshotFields) expect(detail).toContain(`${field}:`);
    expect(detail).toContain("unknown/unavailable");
    expect(detail).toContain("uncertain");
    expect(detail).toContain("partial");
    controller.selectSession("child-a");
    expect(terminalDetail(controller.getView().selected).join(" ")).toContain(
      "blocked",
    );
    controller.stop();
    const stale = controller.getView().selected;
    expect(stale).toBeDefined();
    if (stale) {
      const text = diagnosticRow(stale);
      expect(text).toContain("70.0%");
      expect(text).toContain("pressure unknown");
      expect(text).toContain("performance stale");
      const { snapshot: _, ...withoutSnapshot } = stale;
      const missing = diagnosticRow(withoutSnapshot);
      expect(missing).toContain("Last measured ?/?");
    }
  } finally {
    controller.stop();
  }
});

test("overview keeps every fixture identity compact and selected identity visible through inspection and resize", async () => {
  const { controller, counts } = terminalFixture();
  const shell = new TerminalShell(controller, () => {});
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    for (const [width, height] of [
      [80, 24],
      [40, 20],
    ] as const) {
      const frame = shell.frame(width, height);
      for (const position of [1, 2, 3]) expect(frame).toContain(`#${position}`);
      expect(frame).not.toContain("performance streaming");
      expect(frame).not.toContain("inventory fresh, live fresh");
      expect(frame).toContain("synthetic/alpha");
    }
    shell.key({ name: "end" });
    for (const [width, height] of [
      [20, 12],
      [40, 20],
      [80, 24],
      [20, 6],
      [20, 5],
    ] as const) {
      const frame = shell.frame(width, height);
      expect(
        frame
          .split("\n")
          .some((line) => line.startsWith("> ") && line.includes("#3")),
      ).toBe(true);
      expect(frame).toContain("q quit");
      expect(frame).toContain("detail");
      expect(frame.split("\n").length).toBeLessThanOrEqual(height);
      expect(frame.split("\n").every((line) => cells(line) <= width)).toBe(
        true,
      );
    }
    const id = controller.getView().selectedSessionId;
    const reads = counts.history;
    shell.key({ name: "return" });
    expect(shell.frame(80, 24)).toContain(`Session ID: ${id}`);
    shell.key({ name: "escape" });
    expect(controller.getView().selectedSessionId).toBe(id);
    expect(shell.frame(20, 12)).toContain("> build #3");
    expect(counts.streams).toBe(1);
    expect(counts.history).toBe(reads);
  } finally {
    controller.stop();
  }
});

test("overview formats threshold boundaries, stale usage, lifecycle exceptions and Unicode without unbounded wrapping", async () => {
  const { controller } = terminalFixture();
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    const row = controller.getView().selected;
    if (!row?.snapshot?.measurement)
      throw new Error("Missing fixture measurement");
    const ordinary = {
      ...row,
      snapshot: {
        ...row.snapshot,
        compaction: { ...row.snapshot.compaction, phase: "idle" as const },
      },
    };
    for (const [width, expected] of [
      [80, 1],
      [40, 2],
      [20, 2],
    ] as const) {
      expect(overviewRowLines(ordinary, width, true, "id", 0)).toHaveLength(
        expected,
      );
    }
    for (const [pressure, delta, expected] of [
      ["normal", 100, "100 below"],
      ["near", 1, "Near threshold"],
      ["crossed", -1, "reached"],
      ["crossed", 0, "Threshold reached"],
      ["near", 0, "requires more"],
    ] as const) {
      expect(
        overviewRowLines(
          { ...ordinary, pressure, triggerDeltaTokens: delta },
          80,
          true,
          "id",
          0,
        ).join("\n"),
      ).toContain(expected);
    }
    for (const freshness of ["stale", "missing", "invalid"] as const) {
      const projected = { ...row, freshness };
      const frame = overviewRowLines(projected, 80, true, "id", 0).join("\n");
      expect(frame).toContain("pressure unknown");
      expect(frame).not.toContain("100 below");
      if (freshness === "stale") expect(frame).toContain("Last measured 70%");
      else expect(frame).toContain("?%");
    }
    expect(
      overviewRowLines(
        {
          ...ordinary,
          snapshot: {
            ...ordinary.snapshot,
            measurement: {
              ...row.snapshot.measurement,
              confidence: "approximate",
            },
          },
        },
        80,
        true,
        "id",
        0,
      ).join("\n"),
    ).toContain("~70%");
    for (const [phase, label] of [
      ["accepted", "waiting to start"],
      ["running", "Compaction running"],
      ["awaiting-measurement", "checking context reduction"],
      ["blocked", "automatic retry suppressed"],
      ["uncertain", "Completion unconfirmed"],
    ] as const) {
      expect(
        overviewRowLines(
          {
            ...row,
            snapshot: {
              ...row.snapshot,
              compaction: { ...row.snapshot.compaction, phase },
            },
          },
          100,
          true,
          "id",
          0,
        ).join("\n"),
      ).toContain(label);
    }
    const exceptional = {
      ...row,
      node: {
        ...row.node,
        agent: "研究👩‍💻".repeat(30),
        model: "模型🚀".repeat(30),
        interrupted: true,
      },
      depth: 64,
      inventoryStale: true,
      liveStale: true,
    };
    for (const width of [1, 8, 16, 20, 40, 72, 80, 160]) {
      const lines = overviewRowLines(exceptional, width, true, "研究👩‍💻", 0);
      expect(lines.length).toBeLessThanOrEqual(width >= 72 ? 2 : 3);
      expect(lines.every((line) => cells(line) <= width)).toBe(true);
      if (width >= 16) expect(lines[0]).toStartWith("> ");
      if (width >= 20 && width <= 80) expect(lines.join("\n")).toMatch(/\+\d/);
    }
    const collisions = ["one-same-suffix", "two-same-suffix"].map(
      (sessionId) => ({ ...row, node: { ...row.node, sessionId } }),
    );
    expect(overviewLabels(collisions)).toEqual(["#1", "#2"]);
    expect(terminalDetail(exceptional).join("\n")).toContain(
      "Agent execution interrupted",
    );
  } finally {
    controller.stop();
  }
});

test("overview preserves selected identity through reordered updates, overflowing notices and resize", async () => {
  const { controller, counts } = terminalFixture();
  const shell = new TerminalShell(controller, () => {});
  let projection: ReturnType<typeof spyOn> | undefined;
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    controller.selectSession("child-a");
    const base = controller.getView();
    const view = spyOn(controller, "getView");
    projection = view;
    for (const rows of [
      base.rows,
      [...base.rows].reverse(),
      [base.rows[1], base.rows[2], base.rows[0]].filter(
        (row) => row !== undefined,
      ),
    ]) {
      view.mockReturnValue({
        ...base,
        rows,
        notices: Array.from({ length: 40 }, (_, i) => `Inventory notice ${i}`),
      });
      const index = rows.findIndex((row) => row.node.sessionId === "child-a");
      for (const [width, height] of [
        [80, 24],
        [20, 12],
        [40, 20],
        [20, 7],
      ] as const) {
        const frame = shell.frame(width, height);
        expect(
          frame
            .split("\n")
            .some(
              (line) => line.startsWith("> ") && line.includes(`#${index + 1}`),
            ),
        ).toBe(true);
        expect(frame.split("\n").length).toBeLessThanOrEqual(height);
        if (height >= 12) expect(frame).toContain("40 notices");
      }
    }
    expect(counts.streams).toBe(1);
    expect(counts.history).toBe(0);
  } finally {
    projection?.mockRestore();
    controller.stop();
  }
});

test("overview pages by measured rows and rebases selection through filtering, removal, empty results and location changes", async () => {
  const { controller, snapshots, counts } = terminalFixture();
  const seed = snapshots[1];
  if (!seed) throw new Error("Missing child snapshot");
  for (let i = 0; i < 30; i++)
    snapshots.push({
      ...seed,
      sessionId: `child-extra-${String(i).padStart(2, "0")}`,
    });
  const shell = new TerminalShell(controller, () => {});
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    shell.frame(40, 20);
    shell.key({ name: "pagedown" }, 999);
    expect(controller.getView().selectedSessionId).toBe(
      controller.getView().rows[4]?.node.sessionId,
    );
    shell.frame(20, 12);
    shell.key({ name: "home" });
    shell.frame(20, 12);
    shell.key({ name: "pagedown" }, 999);
    expect(controller.getView().selectedSessionId).toBe(
      controller.getView().rows[2]?.node.sessionId,
    );
    shell.key({ name: "end" });
    const last = controller.getView().selectedSessionId;
    expect(shell.frame(20, 12)).toContain("#33");
    controller.setFilters({ search: "child-a" });
    expect(controller.getView().selectedSessionId).toBe(last);
    shell.frame(20, 12);
    shell.key({ name: "down" });
    expect(shell.frame(20, 12)).toContain("> build #1");
    controller.setFilters({ search: "absent" });
    expect(shell.frame(40, 20)).toContain("No matching sessions");
    controller.setFilters({ search: "" });
    if (!last) throw new Error("Missing selection");
    controller.selectSession(last);
    snapshots.splice(
      snapshots.findIndex((s) => s.sessionId === last),
      1,
    );
    await controller.refresh();
    expect(controller.getView().selectedSessionId).not.toBe(last);
    const selected = controller.getView().selectedSessionId;
    expect(
      shell
        .frame(20, 12)
        .split("\n")
        .some((line) => line.startsWith("> ")),
    ).toBe(true);
    await controller.selectLocation("/another-project");
    await settle(() => controller.getView().connection === "live");
    expect(shell.frame(80, 24)).toContain("/another-project");
    expect(controller.getView().selectedSessionId).toBe(selected);
    expect(counts.history).toBe(0);
  } finally {
    controller.stop();
  }
});

test("status consequences and selected identity survive narrow screens and reconnect without enabling suspended Guard", async () => {
  const { controller, counts } = terminalFixture();
  const shell = new TerminalShell(controller, () => {});
  let projection: ReturnType<typeof spyOn> | undefined;
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    const base = controller.getView();
    if (!base.health) throw new Error("Missing fixture health");
    const view = spyOn(controller, "getView");
    projection = view;
    for (const connection of ["reconnecting", "live"] as const) {
      for (const screen of [
        "overview",
        "detail",
        "history",
        "models",
      ] as const) {
        view.mockReturnValue({
          ...base,
          connection,
          screen,
          health: {
            ...base.health,
            enforcement: "suspended",
            reasons: ["event-stream-gap"],
          },
        });
        for (const [width, height] of [
          [80, 24],
          [40, 20],
          [20, 12],
        ] as const) {
          const frame = shell.frame(width, height);
          expect(frame).toContain("Guard suspended");
          expect(frame.toLowerCase()).toContain("reload required");
          expect(frame).toContain("q quit");
          expect(frame).not.toContain("requests enabled");
          if (height < 18) expect(frame).toContain("Selected: build");
          if (connection === "reconnecting") {
            expect(frame).toContain("Reconnecting");
            expect(frame).toContain("Last known");
            expect(frame).toContain(
              width < 28
                ? "Last data shown"
                : "Showing last received measurements",
            );
          }
          expect(frame.split("\n").length).toBeLessThanOrEqual(height);
          expect(frame.split("\n").every((line) => cells(line) <= width)).toBe(
            true,
          );
        }
      }
    }
    expect(counts.streams).toBe(1);
  } finally {
    projection?.mockRestore();
    controller.stop();
  }
});

test("history screen keeps chart axes and gap columns aligned after dashboard layout", async () => {
  const { controller } = terminalFixture();
  const shell = new TerminalShell(controller, () => {});
  try {
    await controller.start();
    await settle(() => controller.getView().connection === "live");
    shell.key({ name: "3" });
    await settle(() => controller.getView().history.status === "ready");
    for (const width of [20, 35, 80, 180]) {
      for (let metric = 0; metric < 6; metric++) {
        const lines = shell.frame(width, 200).split("\n");
        const rows = lines.filter((line) => line.includes("│"));
        expect(rows).toHaveLength(6);
        const first = rows[0];
        if (!first) throw new Error("History graph is missing");
        const left = first.indexOf("│");
        const right = first.lastIndexOf("│");
        for (const row of rows) {
          expect(row.indexOf("│")).toBe(left);
          expect(row.lastIndexOf("│")).toBe(right);
          expect(row.indexOf("┆")).toBe(first.indexOf("┆"));
        }
        const baseline = lines.find((line) => line.includes("└─"));
        expect(baseline?.indexOf("└")).toBe(left);
        expect(baseline?.indexOf("┘")).toBe(right);
        expect(lines.every((line) => cells(line) <= width)).toBe(true);
        shell.key({ name: "right" });
      }
    }
  } finally {
    controller.stop();
  }
});

test("public native renderer handles resize, editor focus and idempotent shutdown", async () => {
  const signals = process.listenerCount("SIGTERM");
  const { createTestRenderer } = await import("@opentui/core/testing");
  const { TextRenderable } = await import("@opentui/core");
  const host = await createTestRenderer({ width: 80, height: 28 });
  const { controller, counts } = terminalFixture();
  let closed = 0;
  const app = mountTerminal(
    controller,
    host.renderer,
    new TextRenderable(host.renderer, {
      width: "100%",
      height: "100%",
      content: "",
    }),
    () => closed++,
  );
  try {
    await settle(() => controller.getView().connection === "live");
    await settle(() => counts.streams === 1);
    await host.renderOnce();
    expect(host.captureCharFrame()).toContain("Context Guard");
    for (const position of [1, 2, 3])
      expect(host.captureCharFrame()).toContain(`#${position}`);
    app.shell.key({ name: "end" });
    host.resize(20, 12);
    await host.renderOnce();
    expect(host.captureCharFrame()).toContain("> build #3");
    expect(host.captureCharFrame()).toContain("2 detail ? q quit");
    host.resize(24, 10);
    await host.renderOnce();
    expect(host.captureCharFrame()).toContain("Context Guard");
    host.mockInput.pressKey("/");
    await host.mockInput.pasteBracketedText("q");
    expect(closed).toBe(0);
    app.shutdown();
    app.shutdown();
    expect(closed).toBe(1);
    await settle(() => counts.aborted === 1);
    expect(controller.getView().running).toBe(false);
    expect(process.listenerCount("SIGTERM")).toBe(signals);
  } finally {
    app.shutdown();
  }
});

test("renderer initialization and runtime failures stop the controller and remove listeners", async () => {
  const { createTestRenderer } = await import("@opentui/core/testing");
  const { TextRenderable } = await import("@opentui/core");
  for (const startup of [true, false]) {
    const before = process.listenerCount("SIGTERM");
    const host = await createTestRenderer({ width: 30, height: 10 });
    const { controller } = terminalFixture();
    const add = startup
      ? spyOn(host.renderer.root, "add").mockImplementation(() => {
          throw new Error("private exception must not be logged");
        })
      : undefined;
    let failures = 0;
    const app = mountTerminal(
      controller,
      host.renderer,
      new TextRenderable(host.renderer, { content: "" }),
      (failed) => {
        if (failed) failures++;
      },
    );
    add?.mockRestore();
    if (!startup)
      host.renderer.emit("handler:error", {
        error: new Error("private exception must not be logged"),
      });
    app.shutdown();
    expect(failures).toBe(1);
    expect(controller.getView().running).toBe(false);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  }
});
