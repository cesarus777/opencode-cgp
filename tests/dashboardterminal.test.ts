import { test, expect, spyOn } from "bun:test";
import {
  parseDashboardArgs,
  checkTerminalRuntime,
} from "../src/dashboard/command.ts";
import { TerminalShell, mountTerminal } from "../src/dashboard/terminal.ts";
import {
  overviewRow,
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
      const text = overviewRow(stale);
      expect(text).toContain("70.0%");
      expect(text).toContain("pressure unknown");
      expect(text).toContain("performance stale");
      const { snapshot: _, ...withoutSnapshot } = stale;
      const missing = overviewRow(withoutSnapshot);
      expect(missing).toContain("prompt ?/?");
    }
  } finally {
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
