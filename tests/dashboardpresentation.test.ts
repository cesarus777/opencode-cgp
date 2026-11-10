import { expect, spyOn, test } from "bun:test";
import { TerminalShell, mountTerminal } from "../src/dashboard/terminal.ts";
import {
  terminalStyler,
  workspaceContent,
  plainLine,
} from "../src/dashboard/presentation.ts";
import { cells } from "../src/tui/format.ts";
import { terminalFixture } from "./fixtures/dashboard-terminal.ts";

test("workspace follows the selected session across tree paging, resize and full diagnostics without extra reads", async () => {
  const { controller, counts, snapshots } = terminalFixture();
  const seed = snapshots[0];
  if (!seed) throw new Error("Missing fixture");
  for (let i = 0; i < 40; i++)
    snapshots.push({ ...seed, sessionId: `root-${i}` });
  const shell = new TerminalShell(controller, () => {});
  try {
    await controller.start();
    for (const [width, height] of [
      [110, 28],
      [120, 40],
      [180, 50],
    ]) {
      if (width === undefined || height === undefined)
        throw new Error("Missing size");
      shell.key({ name: "end" });
      const view = controller.getView();
      const position =
        view.rows.findIndex(
          (r) => r.node.sessionId === view.selectedSessionId,
        ) + 1;
      const frame = shell.frame(width, height);
      expect(frame).toContain(`> #${position}`);
      expect(frame).toContain("CONTEXT");
      expect(frame).toContain("PERFORMANCE");
      expect(frame).toContain(`Session ID: ${view.selectedSessionId}`);
      expect(frame.split("\n")).toHaveLength(height);
      expect(frame.split("\n").every((text) => cells(text) <= width)).toBe(
        true,
      );
      shell.key({ name: "return" });
      shell.frame(width, height);
      shell.key({ name: "end" });
      const endFrame = shell.frame(width, height);
      expect(endFrame).toContain("performance.tokenSource: estimated");
      expect(endFrame).toContain("completion.");
      shell.key({ name: "escape" });
      expect(shell.frame(40, 20)).toContain("> ");
      expect(shell.presentation).toBeUndefined();
    }
    expect(counts.history).toBe(0);
    expect(counts.streams).toBe(1);
  } finally {
    controller.stop();
  }
});

test("workspace preserves stale occupancy, hides invalid values and uses the actual policy trigger", async () => {
  const { controller } = terminalFixture();
  try {
    await controller.start();
    const base = controller.getView();
    const row = base.selected;
    if (!row?.snapshot) throw new Error("Missing snapshot");
    for (const freshness of ["fresh", "stale", "missing", "invalid"] as const) {
      const view = {
        ...base,
        selected: {
          ...row,
          freshness,
          performanceFreshness: "stale" as const,
          snapshot: {
            ...row.snapshot,
            policy: { ...row.snapshot.policy, triggerTokens: 600 },
          },
        },
      };
      const content = workspaceContent(view, 84, []).map(plainLine).join("\n");
      expect(content).toContain("trigger 600");
      expect(content).toContain("? live TPS");
      expect(content).not.toContain("~12.0");
      if (freshness === "stale") {
        expect(content).toContain("Last measured 70%");
        expect(content).toContain("pressure unknown");
        expect(content).not.toContain("100 tokens below");
      } else if (freshness !== "fresh") {
        expect(content).toContain("?% occupied");
        expect(content).toContain("Context unavailable");
        expect(content).not.toContain("700 /");
      }
    }
  } finally {
    controller.stop();
  }
});

test("workspace never paints a different session's retained chart and keeps Unicode and hostile controls bounded", async () => {
  const { controller, counts } = terminalFixture();
  const shell = new TerminalShell(controller, () => {});
  try {
    await controller.start();
    shell.key({ name: "3" });
    for (
      let i = 0;
      i < 100 && controller.getView().history.status !== "ready";
      i++
    )
      await Bun.sleep(1);
    shell.key({ name: "1" });
    const retained = shell.frame(120, 44);
    expect(retained).toContain("RETAINED LIVE TPS / 5 MINUTES");
    expect(retained).toContain("gap");
    const reads = counts.history;
    shell.key({ name: "down" });
    expect(shell.frame(120, 44)).toContain("load retained measurements");
    expect(counts.history).toBe(reads);
    const base = controller.getView();
    if (!base.selected) throw new Error("Missing session");
    const selected = {
      ...base.selected,
      node: { ...base.selected.node, agent: "研究👩‍💻\x1b[31m".repeat(30) },
    };
    const projection = spyOn(controller, "getView").mockReturnValue({
      ...base,
      selected,
      rows: [selected],
      notices: Array.from({ length: 40 }, () => "Long notice ".repeat(20)),
    });
    try {
      const frame = shell.frame(110, 28);
      expect(frame).not.toContain("\x1b");
      expect(frame).toContain("40 notices");
      expect(frame).toContain("> #1");
      expect(frame.split("\n")).toHaveLength(28);
      expect(frame.split("\n").every((text) => cells(text) <= 110)).toBe(true);
    } finally {
      projection.mockRestore();
    }
  } finally {
    controller.stop();
  }
});

test("native workspace uses terminal color intents, standard slots and text attributes through resize", async () => {
  const api = await import("@opentui/core");
  const { createTestRenderer } = await import("@opentui/core/testing");
  const host = await createTestRenderer({
    width: 120,
    height: 40,
    backgroundColor: api.RGBA.defaultBackground(),
  });
  const { controller } = terminalFixture();
  const text = new api.TextRenderable(host.renderer, {
    width: "100%",
    height: "100%",
    wrapMode: "none",
    fg: api.RGBA.defaultForeground(),
    bg: api.RGBA.defaultBackground(),
  });
  const app = mountTerminal(
    controller,
    host.renderer,
    text,
    () => {},
    terminalStyler(api),
  );
  try {
    for (let i = 0; i < 100 && controller.getView().connection !== "live"; i++)
      await Bun.sleep(1);
    await host.renderOnce();
    expect(host.captureCharFrame()).toContain("PERFORMANCE");
    expect(
      text.chunks.some(
        (part) =>
          part.attributes && part.attributes & api.TextAttributes.INVERSE,
      ),
    ).toBe(true);
    expect(
      text.chunks.some((part) => part.attributes === api.TextAttributes.DIM),
    ).toBe(true);
    expect(
      text.chunks.some(
        (part) => part.fg?.intent === "indexed" && part.fg.slot === 6,
      ),
    ).toBe(true);
    for (const part of text.chunks) {
      expect(part.bg?.intent).toBe("default");
      expect(["default", "indexed"]).toContain(part.fg?.intent ?? "missing");
      if (part.fg?.intent === "indexed")
        expect([1, 2, 3, 6]).toContain(part.fg.slot);
    }
    const captured = host.captureSpans().lines.flatMap((value) => value.spans);
    expect(captured.some((value) => value.fg.intent === "indexed")).toBe(true);
    host.resize(40, 20);
    await host.renderOnce();
    expect(host.captureCharFrame()).toContain("> build / synthetic/alpha #1");
    expect(host.captureCharFrame()).toContain("q quit");
    host.resize(120, 40);
    await host.renderOnce();
    expect(host.captureCharFrame()).toContain("PERFORMANCE");
  } finally {
    app.shutdown();
  }
});
