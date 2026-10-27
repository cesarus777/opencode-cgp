import { isAbsolute } from "node:path";
import type { CliRenderer, KeyEvent, TextRenderable } from "@opentui/core";
import { DashboardController } from "./controller.ts";
import {
  connectDashboard,
  type DashboardConnectionOptions,
} from "./connection.ts";
import { loadTerminalRenderer } from "./command.ts";
import { historyWindows } from "./view.ts";
import { clip } from "../tui/format.ts";
import {
  headerLines,
  historyObservations,
  overviewRow,
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
  scroll = 0;
  metric = 0;
  sample = 0;
  help = false;
  editor: Editor | undefined;
  input = "";
  notice = "";
  private rowOffset = 0;
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
        this.editor = editor === "agent" ? "model" : undefined;
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
            : Math.max(0, Math.min(view.rows.length - 1, index + delta));
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
    width = Math.max(1, width);
    height = Math.max(1, height);
    const view = this.controller.getView();
    const identity = `${view.location}\0${view.selectedSessionId}\0${view.history.windowMs}`;
    if (identity !== this.historyIdentity) {
      this.sample = 0;
      this.scroll = 0;
      this.historyIdentity = identity;
    }
    const footer = this.editor
      ? `${this.editor}> ${this.input} [Enter apply; Esc cancel${this.editor === "location" ? "; Tab remembered" : ""}]`
      : "? help q quit · 1 overview 2 detail 3 history · / search f filters l location r refresh";
    if (height < 5)
      return [
        clip("Context Guard · ? help · q quit", width),
        ...wrapped([footer], width),
      ]
        .slice(0, height)
        .join("\n");
    const header = headerLines(view, width);
    const available = height - header.length - 1;
    const notices = [
      ...view.notices,
      ...view.inventory.notices,
      ...(view.health?.reasons ?? []),
      ...(this.notice ? [this.notice] : []),
      ...(Object.values(view.filters).some(Boolean)
        ? [
            `Filters: search=${view.filters.search} agent=${view.filters.agent} model=${view.filters.model}`,
          ]
        : []),
    ];
    let body: string[];
    if (this.help) body = wrapped(terminalHelp, width);
    else if (view.screen === "overview") {
      // Variable-height rows wrap every field, even in narrow layouts. Track the
      // selected identity through sorting/updates rather than a frontend index.
      const rows = view.rows.map((row) =>
        wrapped(
          [
            `${row.node.sessionId === view.selectedSessionId ? "> " : "  "}${overviewRow(row)}`,
          ],
          width,
        ),
      );
      const selected = view.rows.findIndex(
        (row) => row.node.sessionId === view.selectedSessionId,
      );
      const start = rows
        .slice(0, Math.max(0, selected))
        .reduce((n, row) => n + row.length, 0);
      const end = start + (rows[selected]?.length ?? 0);
      const status = wrapped(notices, width);
      const budget = Math.max(
        1,
        available - Math.min(status.length, Math.floor(available / 3)),
      );
      if (start < this.rowOffset) this.rowOffset = start;
      if (end > this.rowOffset + budget)
        this.rowOffset = Math.max(start, end - budget);
      const flat = rows.flat();
      this.rowOffset = Math.max(
        0,
        Math.min(this.rowOffset, Math.max(0, flat.length - budget)),
      );
      body = [
        ...status.slice(0, available - budget),
        ...(flat.length
          ? flat.slice(this.rowOffset, this.rowOffset + budget)
          : ["No matching sessions; / search, f filters, r refresh."]),
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
            : terminalHistory(view, width, this.metric, this.sample)),
        ],
        width,
      );
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
) {
  let closed = false;
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
    if (closed) return;
    try {
      text.content = shell.frame(renderer.width, renderer.height);
    } catch {
      fail();
    }
  };
  const key = (event: KeyEvent) => {
    try {
      shell.key(event, Math.max(1, renderer.height - 4));
      draw();
    } catch {
      fail();
    }
  };
  const paste = (event: { bytes: Uint8Array }) => {
    shell.paste(new TextDecoder().decode(event.bytes));
    draw();
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
    unsubscribe = controller.subscribe(draw);
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
  const { createCliRenderer, TextRenderable } = await loadTerminalRenderer();
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
      });
      app = mountTerminal(controller, renderer, text, (error) => {
        failed = error;
        done();
      });
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
