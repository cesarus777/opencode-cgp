import { expect, test, spyOn } from "bun:test";
import { DashboardController } from "../src/dashboard/controller.ts";
import { TerminalShell, mountTerminal } from "../src/dashboard/terminal.ts";
import {
  terminalModelRow,
  terminalModels,
} from "../src/dashboard/modelview.ts";
import { wrapped } from "../src/dashboard/terminalview.ts";
import { ModelsController } from "../src/dashboard/models.ts";
import {
  AnalyticsUnavailable,
  type DashboardPort,
} from "../src/dashboard/port.ts";
import type { AnalyticsRead } from "../src/modelseries.ts";
import { cells } from "../src/tui/format.ts";
import { terminalFixture } from "./fixtures/dashboard-terminal.ts";
import { analyticsFixture, analyticsRequest } from "./fixtures/analytics.ts";

async function settle(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await Bun.sleep(2);
  }
  throw new Error("Models fixture did not settle");
}
function fixture(
  records = [
    analyticsRequest("a"),
    analyticsRequest("b", "provider/alpha", 3000, 30),
    analyticsRequest("c", "provider/beta"),
  ],
) {
  const data = analyticsFixture(records);
  const base = terminalFixture();
  // Retain the established monitor/inventory fixture; analytics uses archived IDs.
  const calls: AnalyticsRead[] = [];
  const port = base.port;
  const analytics = async (input: AnalyticsRead, signal: AbortSignal) => {
    calls.push(input);
    return data.service.read(input, signal);
  };
  const rebound = (directory: string): DashboardPort => ({
    ...port.atLocation(directory),
    atLocation: rebound,
    analytics,
  });
  const controller = new DashboardController(
    { ...port, atLocation: rebound, analytics },
    { now: () => 1000000, elapsed: () => 0, refreshIntervalMs: 0 },
  );
  return {
    ...data,
    controller,
    counts: base.counts,
    calls,
    shell: new TerminalShell(controller, () => {}),
  };
}

test("Models shows historical aggregates and metric/bucket navigation reuses one monitor stream", async () => {
  const f = fixture();
  try {
    await f.controller.start();
    await settle(() => f.controller.getView().connection === "live");
    f.shell.frame(100, 60);
    f.shell.key({ name: "4" });
    await settle(() => f.controller.getView().models.status === "ready");
    const list = f.shell.frame(100, 60);
    expect(list).toContain("provider/alpha");
    expect(list).toContain("2 sessions");
    expect(f.controller.getView().models.result?.selected?.averageTps).toBe(
      32.5,
    );
    const bucket =
      f.controller
        .getView()
        .models.result?.buckets.findIndex(
          (b) => b.from <= 990000 && b.to > 990000,
        ) ?? -1;
    expect(
      terminalModels(
        f.controller.getView(),
        100,
        true,
        4,
        bucket,
        0,
        false,
      ).join("\n"),
    ).toContain("Selected Reported output: 130 tokens");
    expect(
      f.controller
        .getView()
        .rows.some((r) => r.node.sessionId === "archived-a"),
    ).toBe(false);
    f.shell.key({ name: "return" });
    await settle(() => f.controller.getView().models.status === "ready");
    const calls = f.calls.length;
    for (let i = 0; i < 5; i++) {
      expect(f.shell.frame(100, 60)).toContain("provider/alpha");
      f.shell.key({ name: "right" });
      f.shell.key({ name: "]" });
    }
    expect(f.calls.length).toBe(calls);
    expect(f.scans()).toBe(1);
    expect(f.counts.streams).toBe(1);
    expect(
      Object.isFrozen(f.controller.getView().models.result?.selected),
    ).toBe(true);
    f.shell.key({ name: "d" });
    expect(f.shell.frame(100, 80)).toContain("archived-a");
    f.shell.key({ name: "escape" });
    expect(f.shell.modelDetail).toBe(false);
    f.shell.key({ name: "down" });
    f.shell.key({ name: "return" });
    await settle(
      () =>
        f.controller.getView().models.result?.selected?.model ===
        "provider/beta",
    );
    expect(
      f.controller.getView().models.result?.selected?.completedRequests,
    ).toBe(1);
    f.shell.key({ name: "w" });
    await settle(() => f.controller.getView().models.status === "ready");
    expect(f.controller.getView().models.result?.selected?.model).toBe(
      "provider/beta",
    );
  } finally {
    f.controller.stop();
    f.service.dispose();
  }
});

test("Models pagination and global sort preserve complete totals without archive rescans", async () => {
  const f = fixture(
    Array.from({ length: 70 }, (_, i) =>
      analyticsRequest(`r-${i}`, `provider/${i.toString().padStart(2, "0")}`),
    ),
  );
  try {
    await f.controller.start();
    f.shell.key({ name: "4" });
    await settle(() => f.controller.getView().models.status === "ready");
    f.shell.key({ name: "n" });
    await settle(
      () =>
        f.controller.getView().models.status === "ready" &&
        f.controller.getView().models.modelPage === 1,
    );
    expect(f.controller.getView().models.result?.models).toHaveLength(20);
    f.shell.key({ name: "p" });
    await settle(
      () =>
        f.controller.getView().models.status === "ready" &&
        f.controller.getView().models.modelPage === 0,
    );
    f.shell.key({ name: "s" });
    await settle(
      () =>
        f.controller.getView().models.status === "ready" &&
        f.controller.getView().models.sort === "tps",
    );
    expect(f.scans()).toBe(1);
  } finally {
    f.controller.stop();
    f.service.dispose();
  }
});

test("Models keeps complete wrapped rows reachable in narrow viewports", async () => {
  const f = fixture();
  try {
    await f.controller.start();
    f.shell.key({ name: "4" });
    await settle(() => f.controller.getView().models.status === "ready");
    for (const width of [1, 20, 35, 80]) {
      f.shell.frame(width, 12);
      await settle(() => f.controller.getView().models.status === "ready");
      f.shell.key({ name: "home" });
      const seen: string[] = [];
      const models = f.controller.getView().models.result?.models ?? [];
      for (let i = 0; i < 1000; i++) {
        const frame = f.shell.frame(width, 12);
        seen.push(...frame.split("\n"));
        const previousScroll = f.shell.scroll;
        const previousFocus = f.shell.modelFocus;
        f.shell.key({ name: "down" });
        if (
          f.shell.scroll === previousScroll &&
          f.shell.modelFocus === previousFocus
        )
          break;
      }
      expect(f.shell.modelFocus).toBe(models.length - 1);
      for (const model of models) {
        for (const line of wrapped(terminalModelRow(model, true), width))
          expect(seen).toContain(line);
      }
      f.shell.key({ name: "end" });
      const bottom = f.shell.frame(width, 12);
      const last = models.at(-1);
      if (!last) throw new Error("Expected model rows");
      expect(bottom.split("\n")).toContain(
        wrapped(terminalModelRow(last, true), width).at(-1) ?? "",
      );
      const reverse: string[] = [];
      for (let i = 0; i < 1000; i++) {
        reverse.push(...f.shell.frame(width, 12).split("\n"));
        const previousScroll = f.shell.scroll;
        const previousFocus = f.shell.modelFocus;
        f.shell.key({ name: "up" });
        if (
          f.shell.scroll === previousScroll &&
          f.shell.modelFocus === previousFocus
        )
          break;
      }
      expect(f.shell.modelFocus).toBe(0);
      for (const model of models) {
        for (const line of wrapped(terminalModelRow(model, true), width))
          expect(reverse).toContain(line);
      }
    }
  } finally {
    f.controller.stop();
    f.service.dispose();
  }
});

test("Models filters ignore session search and agent editor does not start the inventory model editor", async () => {
  const f = fixture([
    analyticsRequest("a"),
    analyticsRequest("b", "provider/beta", 1000, 200, 990000, "review"),
  ]);
  try {
    await f.controller.start();
    f.controller.setFilters({ search: "not-a-session", agent: "review" });
    f.shell.key({ name: "4" });
    await settle(() => f.controller.getView().models.status === "ready");
    expect(f.controller.getView().models.result?.selected?.model).toBe(
      "provider/beta",
    );
    f.shell.key({ name: "f" });
    f.shell.input = "build";
    f.shell.key({ name: "return" });
    expect(f.shell.editor).toBeUndefined();
    await settle(
      () =>
        f.controller.getView().models.status === "ready" &&
        f.controller.getView().models.result?.agent === "build",
    );
    expect(f.controller.getView().models.result?.selected?.model).toBe(
      "provider/alpha",
    );
  } finally {
    f.controller.stop();
    f.service.dispose();
  }
});

test("Models survives expired snapshots, retains stale results after outage and recovers", async () => {
  const f = fixture();
  try {
    await f.controller.start();
    f.shell.key({ name: "4" });
    await settle(() => f.controller.getView().models.status === "ready");
    f.setNow(1100000);
    f.controller.models.select("provider/beta");
    await settle(
      () =>
        f.controller.getView().models.status === "ready" &&
        f.controller.getView().models.result?.selected?.model ===
          "provider/beta",
    );
    const mock = spyOn(f.service, "read").mockRejectedValue(
      new AnalyticsUnavailable("unavailable"),
    );
    await f.controller.refresh();
    await settle(() => f.controller.getView().models.status === "unavailable");
    expect(f.controller.getView().models.stale).toBe(true);
    expect(f.controller.getView().models.result?.selected?.model).toBe(
      "provider/beta",
    );
    mock.mockRestore();
    await f.controller.refresh();
    await settle(() => f.controller.getView().models.status === "ready");
    expect(f.controller.getView().models.stale).toBe(false);
  } finally {
    f.controller.stop();
    f.service.dispose();
  }
});

test("Models capability fallback leaves existing screens operational", async () => {
  const { controller, counts } = terminalFixture();
  try {
    await controller.start();
    controller.setScreen("models");
    expect(controller.getView().models.status).toBe("unsupported");
    expect(
      terminalModels(controller.getView(), 80, false, 0, 0, 0, false).join(" "),
    ).toContain("update the server plugin");
    controller.setScreen("overview");
    expect(controller.getView().rows.length).toBe(3);
    expect(counts.streams).toBe(1);
  } finally {
    controller.stop();
  }
});

test("Models seeds the highlighted row from the exact model filter and preserves it when sorting", async () => {
  const f = fixture();
  try {
    await f.controller.start();
    f.controller.setFilters({
      model: "provider/beta",
      search: "inventory-only",
    });
    f.shell.key({ name: "4" });
    await settle(() => f.controller.getView().models.status === "ready");
    expect(f.shell.frame(100, 80)).toContain("> provider/beta");
    expect(f.shell.frame(100, 80)).not.toContain(
      "Filters: search=inventory-only",
    );
    f.shell.key({ name: "s" });
    await settle(() => f.controller.getView().models.status === "ready");
    expect(f.shell.frame(100, 80)).toContain("> provider/beta");
    f.shell.key({ name: "return" });
    await settle(() => f.controller.getView().models.status === "ready");
    expect(f.controller.getView().models.result?.selected?.model).toBe(
      "provider/beta",
    );
  } finally {
    f.controller.stop();
    f.service.dispose();
  }
});

test("Models cancels obsolete filter/location reads and ignores late responses", async () => {
  const data = analyticsFixture();
  const base = terminalFixture();
  const tasks: {
    input: AnalyticsRead;
    signal: AbortSignal;
    finish: () => void;
  }[] = [];
  const port: DashboardPort = {
    ...base.port,
    analytics: async (input, signal) => {
      await new Promise<void>((resolve) =>
        tasks.push({ input, signal, finish: resolve }),
      );
      return data.service.read(input, new AbortController().signal);
    },
  };
  const models = new ModelsController(() => {});
  try {
    models.configure(port, true, 300000, "build", "", 1000000);
    await settle(() => tasks.length === 1);
    models.configure(port, true, 300000, "review", "", 1000000);
    await settle(() => tasks.length === 2);
    expect(tasks[0]?.signal.aborted).toBe(true);
    tasks[1]?.finish();
    await settle(() => models.getView().status === "ready");
    tasks[0]?.finish();
    await Bun.sleep(5);
    expect(models.getView().result?.agent).toBe("review");
    models.configure(
      { ...port, location: { directory: "/other" } },
      true,
      300000,
      "",
      "",
      1000000,
    );
    expect(models.getView().result).toBeUndefined();
    models.stop();
    for (const task of tasks) task.finish();
  } finally {
    models.stop();
    data.service.dispose();
    base.controller.stop();
  }
});

test("Models charts resize without changing totals and the native renderer preserves chart axes", async () => {
  const f = fixture();
  const { createTestRenderer } = await import("@opentui/core/testing");
  const { TextRenderable } = await import("@opentui/core");
  const host = await createTestRenderer({ width: 100, height: 70 });
  const app = mountTerminal(
    f.controller,
    host.renderer,
    new TextRenderable(host.renderer, {
      content: "",
      width: "100%",
      height: "100%",
    }),
    () => {},
  );
  try {
    await settle(() => f.controller.getView().connection === "live");
    app.shell.key({ name: "4" });
    await settle(() => f.controller.getView().models.status === "ready");
    app.shell.key({ name: "return" });
    for (const width of [20, 35, 80, 180]) {
      host.resize(width, 100);
      app.shell.frame(width, 100);
      await settle(() => f.controller.getView().models.status === "ready");
      const lines = app.shell.frame(width, 100).split("\n");
      expect(lines.every((line) => cells(line) <= width)).toBe(true);
      expect(f.controller.getView().models.result?.selected?.averageTps).toBe(
        32.5,
      );
      const plot = terminalModels(
        f.controller.getView(),
        width,
        true,
        0,
        0,
        0,
        false,
      ).filter((line) => line.includes("│"));
      expect(plot).toHaveLength(6);
      expect(new Set(plot.map((line) => line.indexOf("│"))).size).toBe(1);
      await host.renderOnce();
    }
    expect(f.scans()).toBe(1);
    expect(f.counts.streams).toBe(1);
  } finally {
    app.shutdown();
    f.service.dispose();
  }
});
