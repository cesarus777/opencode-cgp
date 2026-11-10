import { isAbsolute } from "node:path";
import type {
  CliRenderer,
  KeyEvent,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import {
  decorateTerminal,
  plainLine,
  terminalStyler,
  workspaceContent,
  workspaceFrame,
  workspaceWidth,
  type TerminalLine,
} from "./presentation.ts";
import { DashboardController } from "./controller.ts";
import {
  connectDashboard,
  type DashboardConnectionOptions,
} from "./connection.ts";
import { loadTerminalRenderer } from "./command.ts";
import { historyWindows } from "./view.ts";
import { modelMetrics, terminalModelRow, terminalModels } from "./modelview.ts";
import { clip } from "../tui/format.ts";
import {
  headerLines,
  historyObservations,
  overviewHeading,
  overviewLabels,
  overviewRowLines,
  overviewRowHeight,
  terminalDetail,
  terminalHelp,
  terminalHistory,
  wrapped,
} from "./terminalview.ts";

type Editor = "search" | "agent" | "model" | "location";
export interface TerminalKey {
  readonly name: string;
  readonly sequence?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
}

/** Only presentation state lives here; application state stays in the controller. */
export class TerminalShell {
  presentation: readonly TerminalLine[] | undefined;
  readonly work = { formattedOverviewRows: 0 };
  scroll = 0;
  metric = 0;
  sample = 0;
  modelDetail = false;
  modelRequests = false;
  modelFocus = 0;
  private modelFocusId: string | undefined;
  private modelViewport:
    | { focus: number; start: number; end: number; height: number }
    | undefined;
  help = false;
  editor: Editor | undefined;
  input = "";
  notice = "";
  private rowOffset = 0;
  private overviewScope = "";
  private overviewPage = 1;
  private labelKey = "";
  private labels: string[] = [];
  private layouts = new Map<
    string,
    {
      key: string;
      height: number;
      lines?: string[];
      selected?: boolean;
      label?: string;
      position?: number;
    }
  >();
  private historyIdentity = "";
  constructor(
    readonly controller: DashboardController,
    private readonly quit: () => void,
  ) {}

  private task(task: Promise<void>) {
    void task.catch(() => {
      this.notice = "Dashboard action unavailable; refresh to retry.";
    });
  }
  paste(text: string) {
    if (this.editor)
      this.input = (this.input + clip(text, 2048)).slice(
        0,
        this.editor === "location" ? 4096 : 512,
      );
  }
  key(key: TerminalKey, page = 10) {
    const view = this.controller.getView();
    const name = key.name;
    if (key.ctrl && name === "c") {
      this.quit();
      return;
    }
    if (this.editor) {
      if (name === "escape") {
        this.editor = undefined;
        this.notice = "";
      } else if (name === "backspace")
        this.input = Array.from(this.input).slice(0, -1).join("");
      else if (name === "tab" && this.editor === "location") {
        const i = view.locations.indexOf(this.input);
        this.input =
          view.locations[(i + 1) % view.locations.length] ?? view.location;
      } else if (name === "return" || name === "enter") {
        const editor = this.editor;
        if (editor === "location") {
          if (!isAbsolute(this.input)) {
            this.notice =
              "Location must be an owning absolute server directory.";
            return;
          }
          this.task(this.controller.selectLocation(this.input));
        } else this.controller.setFilters({ [editor]: this.input });
        this.editor =
          editor === "agent" && view.screen !== "models" ? "model" : undefined;
        this.input = this.editor === "model" ? view.filters.model : "";
        this.scroll = 0;
        this.notice = "";
      } else if (
        !key.ctrl &&
        !key.meta &&
        key.sequence &&
        !/[\x00-\x1f\x7f-\x9f]/.test(key.sequence)
      )
        this.paste(key.sequence);
      return;
    }
    if (name === "q") {
      this.quit();
      return;
    }
    if (name === "?" || key.sequence === "?") {
      this.help = !this.help;
      this.scroll = 0;
      return;
    }
    if (name === "escape") {
      this.help = false;
      this.scroll = 0;
      if (view.screen === "models" && this.modelDetail) {
        this.modelDetail = false;
        this.modelRequests = false;
        return;
      }
      this.controller.setScreen("overview");
      return;
    }
    if (name === "/" || key.sequence === "/") {
      this.editor = "search";
      this.input = view.filters.search;
      return;
    }
    if (name === "f") {
      this.editor = "agent";
      this.input = view.filters.agent;
      return;
    }
    if (name === "l") {
      this.editor = "location";
      this.input = view.location;
      return;
    }
    if (name === "r") {
      this.task(this.controller.refresh());
      return;
    }
    if (name === "4") {
      this.help = false;
      this.scroll = 0;
      this.modelDetail = false;
      this.modelRequests = false;
      this.controller.setScreen("models");
      return;
    }
    if (view.screen === "models" && !this.help) {
      if (name === "enter" || name === "return") {
        const model = view.models.result?.models[this.modelFocus];
        if (model) {
          this.controller.models.select(model.model ?? "");
          this.modelDetail = true;
          this.modelRequests = false;
          this.sample = 0;
          this.scroll = 0;
        }
        return;
      }
      if (name === "w") {
        this.controller.setWindow(
          historyWindows[
            (historyWindows.indexOf(view.models.windowMs) + 1) %
              historyWindows.length
          ] ?? historyWindows[0],
        );
        this.sample = 0;
        this.scroll = 0;
        return;
      }
      if (name === "s" && !this.modelDetail) {
        this.controller.models.sort();
        this.scroll = 0;
        return;
      }
      if (name === "n" || name === "p") {
        if (!this.modelDetail || this.modelRequests) {
          this.controller.models.page(
            this.modelDetail ? "requests" : "models",
            name === "n" ? 1 : -1,
          );
          if (!this.modelDetail) {
            this.modelFocus = 0;
            this.modelFocusId = undefined;
          }
          this.scroll = 0;
        }
        return;
      }
      if (this.modelDetail) {
        if (name === "d") {
          this.modelRequests = !this.modelRequests;
          this.scroll = 0;
          return;
        }
        if (name === "left" || name === "right") {
          this.metric =
            (this.metric + modelMetrics.length + (name === "left" ? -1 : 1)) %
            modelMetrics.length;
          this.sample = 0;
          this.scroll = 0;
          return;
        }
        if (name === "[" || name === "]") {
          this.sample = Math.max(
            0,
            Math.min(
              (view.models.result?.buckets.length ?? 1) - 1,
              this.sample + (name === "[" ? -1 : 1),
            ),
          );
          return;
        }
      } else if (
        ["up", "down", "j", "k", "home", "end", "pageup", "pagedown"].includes(
          name,
        )
      ) {
        const models = view.models.result?.models ?? [];
        const delta =
          name === "down" || name === "j"
            ? 1
            : name === "up" || name === "k"
              ? -1
              : name === "pagedown"
                ? page
                : -page;
        const viewport = this.modelViewport;
        if (
          viewport?.focus === this.modelFocus &&
          viewport.end - viewport.start > viewport.height &&
          name !== "home" &&
          name !== "end" &&
          (delta > 0
            ? this.scroll + viewport.height < viewport.end
            : this.scroll > viewport.start)
        ) {
          this.scroll = Math.max(
            viewport.start,
            Math.min(viewport.end - viewport.height, this.scroll + delta),
          );
          return;
        }
        if (name === "home") this.scroll = 0;
        if (name === "end") this.scroll = Number.MAX_SAFE_INTEGER;
        this.modelFocus = Math.max(
          0,
          Math.min(
            models.length - 1,
            name === "home"
              ? 0
              : name === "end"
                ? models.length - 1
                : this.modelFocus + delta,
          ),
        );
        this.modelFocusId = models[this.modelFocus]?.model ?? "";
        return;
      }
    }
    if (["1", "2", "3", "return", "enter"].includes(name)) {
      this.help = false;
      this.scroll = 0;
      this.controller.setScreen(
        name === "1" ? "overview" : name === "3" ? "history" : "detail",
      );
      return;
    }
    if (view.screen === "history" && !this.help) {
      if (name === "left" || name === "right") {
        this.metric = (this.metric + (name === "left" ? 5 : 1)) % 6;
        this.sample = 0;
        this.scroll = 0;
        return;
      }
      if (name === "w") {
        this.controller.setWindow(
          historyWindows[
            (historyWindows.indexOf(view.history.windowMs) + 1) %
              historyWindows.length
          ] ?? historyWindows[0],
        );
        this.sample = 0;
        return;
      }
      if (name === "[" || name === "]") {
        this.sample = Math.max(
          0,
          Math.min(
            historyObservations(view, this.metric).length - 1,
            this.sample + (name === "[" ? -1 : 1),
          ),
        );
        return;
      }
    }
    const delta =
      name === "down" || name === "j"
        ? 1
        : name === "up" || name === "k"
          ? -1
          : name === "pagedown"
            ? page
            : name === "pageup"
              ? -page
              : 0;
    if (view.screen === "overview" && !this.help) {
      const index = view.rows.findIndex(
        (row) => row.node.sessionId === view.selectedSessionId,
      );
      const next =
        name === "home"
          ? 0
          : name === "end"
            ? view.rows.length - 1
            : Math.max(
                0,
                Math.min(
                  view.rows.length - 1,
                  index +
                    (name === "pagedown"
                      ? this.overviewPage
                      : name === "pageup"
                        ? -this.overviewPage
                        : delta),
                ),
              );
      const row = view.rows[next];
      if (row && (delta || name === "home" || name === "end"))
        this.controller.selectSession(row.node.sessionId);
    } else
      this.scroll =
        name === "home"
          ? 0
          : name === "end"
            ? Number.MAX_SAFE_INTEGER
            : Math.max(0, this.scroll + delta);
  }

  frame(width: number, height: number): string {
    this.presentation = undefined;
    width = Math.max(1, width);
    height = Math.max(1, height);
    this.controller.models.setWidth(width);
    const view = this.controller.getView();
    if (view.screen === "models") {
      const models = view.models.result?.models ?? [];
      const identity =
        this.modelFocusId ?? view.models.result?.selected?.model ?? "";
      const focused = models.findIndex((m) => (m.model ?? "") === identity);
      this.modelFocus = Math.max(
        0,
        focused < 0 ? Math.min(this.modelFocus, models.length - 1) : focused,
      );
      if (view.models.status === "ready" && models.length)
        this.modelFocusId = models[this.modelFocus]?.model ?? "";
    }
    const identity =
      view.screen === "models"
        ? JSON.stringify([
            view.location,
            view.models.windowMs,
            view.filters.agent,
            view.models.result?.selected?.model,
          ])
        : `${view.location}\0${view.selectedSessionId}\0${view.history.windowMs}`;
    if (identity !== this.historyIdentity) {
      this.sample = 0;
      this.scroll = 0;
      this.historyIdentity = identity;
    }
    const footer = this.editor
      ? `${this.editor}> ${this.input} [Enter apply; Esc cancel${this.editor === "location" ? "; Tab remembered" : ""}]`
      : view.screen === "overview" && !this.help
        ? width < 40
          ? width >= 22
            ? "2 detail ? help q quit"
            : "2 detail ? q quit"
          : width < 72
            ? "2 detail · q quit · ? help · ↑↓ select"
            : "Enter detail · q quit · ? help · ↑↓ select · 3 history 4 models / search f filters l location r refresh"
        : width < 40
          ? "? help q quit"
          : "? help q quit · 1 overview 2 detail 3 history 4 models · / search f filters l location r refresh";
    if (height < 5)
      return [
        clip("Context Guard · ? help · q quit", width),
        ...wrapped([footer], width),
      ]
        .slice(0, height)
        .join("\n");
    const header = headerLines(view, width, height);
    if (view.screen === "overview" && !this.help) {
      // Inventory/location/selected summary is optional; retain room for the row.
      while (
        header.length > height - 2 &&
        /^(Known |Location: |Selected: )/.test(header.at(-1) ?? "")
      )
        header.pop();
      // Below usable geometry, bound the fallback rather than overflow the PTY.
      header.splice(Math.max(0, height - 2));
    }
    const available = Math.max(0, height - header.length - 1);
    const notices = [
      ...(view.screen === "overview" &&
      view.selectedSessionId &&
      !view.rows.some((row) => row.node.sessionId === view.selectedSessionId)
        ? ["Selection hidden by filters · ↑↓ selects a visible session"]
        : []),
      ...view.notices,
      ...view.inventory.notices,
      ...(view.screen === "detail"
        ? (view.health?.reasons.map(
            (reason) => `Health reason code: ${reason}`,
          ) ?? [])
        : []),
      ...(this.notice ? [this.notice] : []),
      ...(view.screen !== "models" && Object.values(view.filters).some(Boolean)
        ? [
            `Filters: search=${view.filters.search} agent=${view.filters.agent} model=${view.filters.model}`,
          ]
        : []),
    ];
    if (
      width >= 110 &&
      height >= 28 &&
      !this.help &&
      (view.screen === "overview" || view.screen === "detail")
    ) {
      const content = workspaceContent(view, workspaceWidth(width), notices);
      const bodyHeight = height - header.length - 3;
      this.overviewPage = Math.max(1, Math.floor((bodyHeight - 4) / 3));
      this.scroll =
        view.screen === "overview"
          ? 0
          : Math.max(0, Math.min(this.scroll, content.length - bodyHeight));
      this.presentation = workspaceFrame(
        header,
        view,
        width,
        height,
        content,
        this.scroll,
        this.editor
          ? footer
          : view.screen === "overview"
            ? "↑↓ select · Enter full detail · 3 history · / search · f filters · l location · r refresh · ? help · q quit"
            : "↑↓ scroll · 1 select session · 3 history · / search · r refresh · ? help · q quit",
      );
      return this.presentation.map(plainLine).join("\n");
    }
    let body: string[];
    if (this.help) body = wrapped(terminalHelp, width);
    else if (view.screen === "overview") {
      const scope = JSON.stringify([view.location, view.filters]);
      if (scope !== this.overviewScope) {
        this.rowOffset = 0;
        this.overviewScope = scope;
      }
      const heading = available >= 4 ? overviewHeading(width) : [];
      const noticeBudget = Math.min(
        notices.length,
        Math.floor((available - heading.length) / 4),
      );
      const status = notices
        .slice(0, noticeBudget)
        .map((notice, index) =>
          clip(
            index === noticeBudget - 1 && notices.length > noticeBudget
              ? `${notices.length} notices · see Details`
              : notice,
            width,
          ),
        );
      const budget = Math.max(1, available - heading.length - status.length);
      const labelKey = view.rows.map((row) => row.node.sessionId).join("\0");
      if (labelKey !== this.labelKey) {
        this.labels = overviewLabels(view.rows);
        this.labelKey = labelKey;
      }
      const ids = new Set(view.rows.map((row) => row.node.sessionId));
      for (const id of this.layouts.keys())
        if (!ids.has(id)) this.layouts.delete(id);
      const heights = view.rows.map((row) => {
        const key = JSON.stringify([
          width,
          budget,
          row.node,
          row.depth,
          row.freshness,
          row.pressure,
          row.triggerDeltaTokens,
          row.utilizationPercent,
          row.snapshot?.measurement?.confidence,
          row.snapshot?.compaction,
          row.inventoryStale,
          row.liveStale,
          row.hidden,
        ]);
        let layout = this.layouts.get(row.node.sessionId);
        if (!layout || layout.key !== key) {
          layout = { key, height: overviewRowHeight(row, width, budget) };
          this.layouts.set(row.node.sessionId, layout);
        }
        return layout.height;
      });
      const selected = view.rows.findIndex(
        (row) => row.node.sessionId === view.selectedSessionId,
      );
      const start = heights
        .slice(0, Math.max(0, selected))
        .reduce((n, h) => n + h, 0);
      const end = start + (heights[selected] ?? 0);
      if (start < this.rowOffset) this.rowOffset = start;
      if (end > this.rowOffset + budget)
        this.rowOffset = Math.max(start, end - budget);
      const total = heights.reduce((n, h) => n + h, 0);
      this.rowOffset = Math.max(
        0,
        Math.min(this.rowOffset, Math.max(0, total - budget)),
      );
      const visible: string[] = [];
      let cursor = 0,
        page = 0;
      for (const [index, row] of view.rows.entries()) {
        const rowHeight = heights[index] ?? 1;
        if (
          cursor >= this.rowOffset &&
          cursor + rowHeight <= this.rowOffset + budget
        )
          page++;
        if (
          cursor + rowHeight > this.rowOffset &&
          cursor < this.rowOffset + budget
        ) {
          const layout = this.layouts.get(row.node.sessionId);
          const chosen = row.node.sessionId === view.selectedSessionId;
          const label = this.labels[index] ?? `#${index + 1}`;
          if (layout) {
            if (
              !layout.lines ||
              layout.selected !== chosen ||
              layout.label !== label ||
              layout.position !== index
            ) {
              this.work.formattedOverviewRows++;
              layout.lines = overviewRowLines(
                row,
                width,
                chosen,
                label,
                index,
                budget,
              );
              layout.selected = chosen;
              layout.label = label;
              layout.position = index;
            }
            visible.push(
              ...layout.lines.slice(
                Math.max(0, this.rowOffset - cursor),
                this.rowOffset + budget - cursor,
              ),
            );
          }
        }
        cursor += rowHeight;
      }
      this.overviewPage = Math.max(1, page);
      body = [
        ...status,
        ...heading,
        ...(total
          ? visible
          : [
              clip(
                "No matching sessions; / search, f filters, r refresh.",
                width,
              ),
            ]),
      ];
      return [
        ...header,
        ...body,
        ...Array.from(
          { length: Math.max(0, available - body.length) },
          () => "",
        ),
        clip(footer, width),
      ].join("\n");
    } else
      body = wrapped(
        [
          ...notices,
          ...(view.screen === "detail"
            ? terminalDetail(view.selected)
            : view.screen === "models"
              ? terminalModels(
                  view,
                  width,
                  this.modelDetail,
                  this.metric,
                  this.sample,
                  this.modelFocus,
                  this.modelRequests,
                )
              : terminalHistory(view, width, this.metric, this.sample)),
        ],
        width,
      );
    this.modelViewport = undefined;
    if (
      view.screen === "models" &&
      !this.modelDetail &&
      !this.help &&
      view.models.result?.models.length
    ) {
      const heights = (view.models.result?.models ?? []).map(
        (model, index) =>
          wrapped(terminalModelRow(model, index === this.modelFocus), width)
            .length,
      );
      const start =
        body.length - heights.slice(this.modelFocus).reduce((a, b) => a + b, 0);
      const end = start + (heights[this.modelFocus] ?? 0);
      this.modelViewport = {
        focus: this.modelFocus,
        start,
        end,
        height: available,
      };
      if (end - start > available) {
        // A tall row is a viewport of its own: arrows can visit every line
        // before advancing to the next model.
        this.scroll = Math.max(start, Math.min(this.scroll, end - available));
      } else {
        if (start < this.scroll) this.scroll = start;
        if (end > this.scroll + available) this.scroll = end - available;
      }
    }
    this.scroll = Math.max(
      0,
      Math.min(this.scroll, Math.max(0, body.length - available)),
    );
    return [
      ...header,
      ...body.slice(this.scroll, this.scroll + available),
      ...Array.from({ length: Math.max(0, available - body.length) }, () => ""),
      clip(footer, width),
    ].join("\n");
  }
}

/** Public renderer lifecycle; injected renderer permits offline native tests. */
export function mountTerminal(
  controller: DashboardController,
  renderer: CliRenderer,
  text: TextRenderable,
  finished: (failed: boolean) => void,
  style?: (lines: readonly TerminalLine[]) => StyledText,
) {
  let closed = false,
    pendingDraw = false,
    drawing = false;
  let unsubscribe = () => {};
  const shutdown = (failed = false) => {
    if (closed) return;
    closed = true;
    unsubscribe();
    controller.stop();
    renderer.keyInput.off("keypress", key);
    renderer.keyInput.off("paste", paste);
    renderer.off("resize", draw);
    renderer.off("render:error", fail);
    renderer.off("handler:error", fail);
    renderer.off("destroy", destroyed);
    for (const signal of signals) process.off(signal, onSignal);
    process.off("uncaughtException", fail);
    process.off("unhandledRejection", fail);
    try {
      renderer.destroy();
    } finally {
      finished(failed);
    }
  };
  const shell = new TerminalShell(controller, () => shutdown());
  const fail = () => shutdown(true);
  const destroyed = () => shutdown();
  const onSignal = () => shutdown();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const draw = () => {
    if (closed || drawing) return;
    pendingDraw = false;
    drawing = true;
    try {
      const frame = shell.frame(renderer.width, renderer.height);
      text.content = style
        ? style(shell.presentation ?? decorateTerminal(frame))
        : frame;
    } catch {
      fail();
    } finally {
      drawing = false;
    }
  };
  const scheduleDraw = () => {
    if (pendingDraw || closed || drawing) return;
    pendingDraw = true;
    queueMicrotask(() => {
      if (pendingDraw) draw();
    });
  };
  const key = (event: KeyEvent) => {
    try {
      shell.key(event, Math.max(1, renderer.height - 4));
      scheduleDraw();
    } catch {
      fail();
    }
  };
  const paste = (event: { bytes: Uint8Array }) => {
    shell.paste(new TextDecoder().decode(event.bytes));
    scheduleDraw();
  };
  try {
    renderer.root.add(text);
    renderer.keyInput.on("keypress", key);
    renderer.keyInput.on("paste", paste);
    renderer.on("resize", draw);
    renderer.on("render:error", fail);
    renderer.on("handler:error", fail);
    renderer.on("destroy", destroyed);
    for (const signal of signals) process.on(signal, onSignal);
    process.on("uncaughtException", fail);
    process.on("unhandledRejection", fail);
    unsubscribe = controller.subscribe(scheduleDraw);
    draw();
    if (closed) {
      unsubscribe();
      return { shell, shutdown };
    }
    void controller.start().catch(fail);
  } catch {
    shutdown(true);
  }
  return { shell, shutdown };
}

export async function runTerminal(
  options: DashboardConnectionOptions,
): Promise<void> {
  const api = await loadTerminalRenderer();
  const { createCliRenderer, TextRenderable, RGBA } = api;
  const connection = await connectDashboard(options);
  await connection.info(AbortSignal.timeout(15000));
  const controller = new DashboardController(connection);
  // The public factory restores terminal state if setupTerminal itself fails.
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: false,
    screenMode: "alternate-screen",
    consoleMode: "disabled",
    openConsoleOnError: false,
    backgroundColor: RGBA.defaultBackground(),
  });
  let failed = false;
  let app: ReturnType<typeof mountTerminal> | undefined;
  try {
    await new Promise<void>((done) => {
      const text = new TextRenderable(renderer, {
        id: "dashboard",
        width: "100%",
        height: "100%",
        content: "",
        wrapMode: "none",
        fg: RGBA.defaultForeground(),
        bg: RGBA.defaultBackground(),
      });
      app = mountTerminal(
        controller,
        renderer,
        text,
        (error) => {
          failed = error;
          done();
        },
        terminalStyler(api),
      );
    });
  } finally {
    if (app) app.shutdown();
    else {
      controller.stop();
      renderer.destroy();
    }
  }
  if (failed)
    throw new Error(
      "Terminal dashboard stopped after a runtime failure; terminal restored",
    );
}
