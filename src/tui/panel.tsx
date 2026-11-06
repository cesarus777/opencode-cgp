import type { ScrollBoxRenderable } from "@opentui/core";
import type { Plugin } from "@opencode/plugin/tui";
import type { KeymapCommand, PanelInput } from "@opencode/plugin/tui/context";
import {
  createSignal,
  createMemo,
  createEffect,
  on,
  onCleanup,
  Show,
  For,
} from "solid-js";
import type { GuardState } from "./state.ts";
import type { GuardRow } from "../family.ts";
import { HistoryCharts } from "./charts.tsx";
import { routeFamily } from "./compactformat.ts";
import { PanelDetails, PanelOverview } from "./panelview.tsx";
import {
  compactionLabel,
  panelRowHeading,
  panelSummary,
} from "./panelformat.ts";
import { chartMetrics } from "./chartformat.ts";
import { cells, clip, wrap } from "./format.ts";
import { connectionLabel, monitorStatusLines } from "./statusformat.ts";
import { footerActions, inventoryMessages } from "./panelcontrols.ts";

type PanelView = "overview" | "details" | "charts";
export function GuardPanel(props: {
  input: PanelInput;
  state: GuardState;
  context: Plugin.Context;
}) {
  const consumer = props.state.acquire(props.input.sessionID);
  createEffect(
    on(
      () => props.input.sessionID,
      (id) => consumer.update(id),
    ),
  );
  onCleanup(() => consumer.release());
  const [help, setHelp] = createSignal(false);
  let sourceScroll = 0;
  const [view, setView] = createSignal<PanelView>("overview");
  const [metricIndex, setMetricIndex] = createSignal(0);
  const [viewportWidth, setViewportWidth] = createSignal<number>();
  const [height, setHeight] = createSignal(24);
  const width = () =>
    Math.max(1, Math.min(props.input.width - 4, viewportWidth() ?? Infinity));
  const compact = () => height() < 18;
  const windows = [300000, 3600000, 86400000, 7 * 86400000];
  const [windowIndex, setWindowIndex] = createSignal(1);
  const [chartRefresh, setChartRefresh] = createSignal(0);
  const [selected, setSelected] = createSignal<string | undefined>(
    props.input.sessionID,
  );
  const [order, setOrder] = createSignal<readonly string[]>([]);
  const rows = createMemo(() => props.state.rows(order()));
  const family = createMemo(() =>
    routeFamily(props.state.rows([], true), props.input.sessionID),
  );
  const selectedRow = createMemo(() =>
    rows().find((row) => row.node.sessionId === selected()),
  );
  const offset = () =>
    Math.max(
      0,
      rows().findIndex((row) => row.node.sessionId === selected()),
    );
  // Keep the bounded display trace current even when its chart is not mounted.
  const trace = createMemo(() => props.state.contextTrace(selectedRow()));
  createEffect(() => {
    const current = rows().find(
      (row) => row.node.sessionId === props.input.sessionID,
    );
    if (current && current.node.sessionId !== selected())
      props.state.contextTrace(current);
  });
  createEffect(() => {
    if (!props.input.focused) setOrder([]);
  });
  createEffect(
    on(
      () => props.input.sessionID,
      (id) => {
        setSelected(id);
        setOrder([]);
        setHelp(false);
        sourceScroll = 0;
        setView("overview");
      },
    ),
  );
  createEffect(() => {
    const family = rows();
    if (!family.some((row) => row.node.sessionId === selected()))
      setSelected(
        family.find((row) => row.node.sessionId === props.input.sessionID)?.node
          .sessionId ?? family[0]?.node.sessionId,
      );
  });
  let scroll: ScrollBoxRenderable | undefined;
  let follow: ((deltaTime: number) => Promise<void>) | undefined;
  function cancelFollow() {
    if (follow) props.context.renderer.removeFrameCallback(follow);
    follow = undefined;
  }
  function afterLayout(action: () => void) {
    if (!props.context.renderer) return;
    cancelFollow();
    let frames = 0;
    follow = async () => {
      action();
      if (++frames >= 2) cancelFollow();
      else props.context.renderer.requestRender();
    };
    props.context.renderer.setFrameCallback(follow);
    props.context.renderer.requestRender();
  }
  function revealSelection() {
    afterLayout(() =>
      scroll?.scrollChildIntoView(`context-guard.row.${selected()}`),
    );
  }
  function toggleHelp() {
    cancelFollow();
    if (!help()) {
      sourceScroll = scroll?.scrollTop ?? 0;
      setHelp(true);
      afterLayout(() => scroll?.scrollTo(0));
    } else {
      setHelp(false);
      afterLayout(() => scroll?.scrollTo(sourceScroll));
    }
  }
  onCleanup(cancelFollow);
  createEffect(() => {
    view();
    selected();
    rows();
    width();
    height();
    if (!help() && view() === "overview") revealSelection();
  });
  function changeView(next: PanelView) {
    if (next !== "overview" && !selectedRow()) return;
    cancelFollow();
    setView(next);
    scroll?.scrollTo(0);
    if (next === "overview") revealSelection();
  }
  function move(delta: number) {
    setOrder(rows().map((row) => row.node.sessionId));
    const row =
      rows()[Math.max(0, Math.min(rows().length - 1, offset() + delta))];
    if (row) setSelected(row.node.sessionId);
    if (view() === "charts") scroll?.scrollTo(0);
  }
  function open(row: GuardRow | undefined) {
    if (!row) return;
    props.input.close();
    props.context.ui.router.navigate({
      type: "session",
      sessionID: row.node.sessionId,
    });
  }
  function page(delta: number) {
    if (!help() && view() === "overview")
      move(
        delta *
          Math.max(
            1,
            Math.floor(
              (scroll?.viewport.height ?? 1) / (width() >= 72 ? 1 : 3),
            ),
          ),
      );
    else
      scroll?.scrollBy(delta * Math.max(1, (scroll.viewport.height ?? 1) - 1));
  }
  function edge(last: boolean) {
    if (!help() && view() === "overview")
      move(last ? rows().length : -rows().length);
    else scroll?.scrollTo(last ? scroll.scrollHeight : 0);
  }
  const inventory = () => props.state.inventoryStatus();
  const expandable = () => {
    const row = selectedRow();
    return (
      !!row &&
      (row.hidden > 0 ||
        (row.node.status === "completed" &&
          rows().some((r) => r.node.parentId === row.node.sessionId)))
    );
  };
  function command(
    name: string,
    title: string,
    bind: string,
    run: () => void,
    enabled: () => boolean = () => !help(),
  ): KeymapCommand {
    return {
      id: `context-guard.${name}`,
      title,
      bind,
      enabled,
      run: () => {
        if (props.input.focused && enabled()) run();
      },
    };
  }
  const commands = () => [
    command(
      "close",
      "Close Context Guard",
      "q",
      () => props.input.close(),
      () => true,
    ),
    command("help", "Toggle native panel help", "?", toggleHelp, () => true),
    command("help-back", "Return from help", "escape", toggleHelp, help),
    command(
      "chart-previous",
      "Previous chart metric",
      "left",
      () =>
        setMetricIndex(
          (i) => (i + chartMetrics.length - 1) % chartMetrics.length,
        ),
      () => !help() && view() === "charts",
    ),
    command(
      "chart-next",
      "Next chart metric",
      "right",
      () => setMetricIndex((i) => (i + 1) % chartMetrics.length),
      () => !help() && view() === "charts",
    ),
    command(
      "charts",
      "Toggle performance charts",
      "c",
      () => changeView(view() === "charts" ? "overview" : "charts"),
      () => !help() && !!selectedRow(),
    ),
    command(
      "chart-shorter",
      "Shorter chart window",
      "[",
      () => setWindowIndex((i) => Math.max(0, i - 1)),
      () => !help() && view() === "charts",
    ),
    command(
      "chart-longer",
      "Longer chart window",
      "]",
      () => setWindowIndex((i) => Math.min(windows.length - 1, i + 1)),
      () => !help() && view() === "charts",
    ),
    command(
      "inspect",
      "Toggle selected session details",
      "i",
      () => changeView(view() === "details" ? "overview" : "details"),
      () => !help() && !!selectedRow(),
    ),
    command(
      "refresh",
      "Refresh inventory, measurements and active charts",
      "r",
      () => {
        setOrder([]);
        props.state.refresh();
        setChartRefresh((n) => n + 1);
      },
    ),
    command(
      "load-more",
      "Load more family",
      "l",
      () => props.state.loadMore(),
      () => !help() && view() === "overview" && inventory().canLoadMore,
    ),
    command(
      "next",
      "Next session or scroll down",
      "down",
      () => (help() || view() === "details" ? scroll?.scrollBy(1) : move(1)),
      () => true,
    ),
    command(
      "previous",
      "Previous session or scroll up",
      "up",
      () => (help() || view() === "details" ? scroll?.scrollBy(-1) : move(-1)),
      () => true,
    ),
    command(
      "page-next",
      "Next page",
      "pagedown",
      () => page(1),
      () => true,
    ),
    command(
      "page-previous",
      "Previous page",
      "pageup",
      () => page(-1),
      () => true,
    ),
    command(
      "first",
      "First row or top",
      "home",
      () => edge(false),
      () => true,
    ),
    command(
      "last",
      "Last row or bottom",
      "end",
      () => edge(true),
      () => true,
    ),
    command(
      "expand",
      "Toggle selected branch",
      "space",
      () => {
        const row = selectedRow();
        if (row) props.state.expand(row.node.sessionId);
      },
      () => !help() && view() === "overview" && expandable(),
    ),
    command(
      "open",
      "Open selected session",
      "return",
      () => open(selectedRow()),
      () => !help() && !!selectedRow(),
    ),
  ];
  props.context.keymap.layer(() => ({
    enabled: () => props.input.focused,
    commands: commands(),
  }));
  const shortcut = (name: string) =>
    props.context.keymap.shortcuts(`context-guard.${name}`).join("/");
  const helpLines = () =>
    [
      "Native OpenCode panel — keyboard help",
      `Return to ${view()}; selected session: ${selectedRow()?.node.agent ?? selected() ?? "none"}`,
      "> marks selection; * marks the current OpenCode route. Open selected session navigates there and closes the panel.",
      "Overview: arrows select agents. Details: arrows scroll. Charts: arrows select sessions; Left/Right changes metric and brackets change window.",
      "PageUp/PageDown moves selection in Overview and scrolls Details/Charts/help. Home/End reaches the first/last row or top/bottom.",
      "Space toggles a branch in Overview. Load more resumes pending family discovery when available.",
      ...inventoryMessages(inventory()),
      `Discovered ${inventory().discovered} · node limit ${inventory().limit} · pages ${inventory().pages} · pending branches ${inventory().pending}`,
      "Refresh rescans inventory and measurements; it cannot resume suspended enforcement. Reload/repair instructions remain in Guard status.",
      "Configured native bindings (unbound actions have no shortcut):",
      ...commands().map(
        (c) =>
          `${props.context.keymap.shortcuts(c.id ?? "").join(" / ") || "Unbound"}: ${c.title}`,
      ),
      "Default bindings differ: native l loads more; standalone l edits location. Native brackets change windows; standalone brackets inspect observations and w changes windows.",
      "Open Context Guard is also available in the root prompt slash menu and command palette. Set the client plugin option openShortcut for keyboard entry from a child composer.",
      "End of native panel help",
    ].flatMap((line) => wrap(line, width()));
  const statusLines = () =>
    monitorStatusLines(
      props.state.connection(),
      props.state.health(),
      rows().some((row) => row.snapshot?.measurement !== undefined),
      width() < 28,
    ).flatMap((line) => wrap(line, width()));
  const notice = () => compactionLabel(selectedRow());
  const actions = () => {
    const action = (name: string, label: string) => ({
      id: name,
      label:
        ["help", "close"].includes(name) &&
        cells(`${shortcut(name)} ${label}`) > Math.floor((width() - 1) / 2)
          ? label
          : `${shortcut(name) ? shortcut(name) + " " : ""}${label}`,
      run: () => {
        commands()
          .find((c) => c.id === `context-guard.${name}`)
          ?.run();
      },
    });
    const optional = help()
      ? [action("help-back", "back")]
      : [
          ...(view() === "overview" && inventory().canLoadMore
            ? [action("load-more", "more")]
            : []),
          ...(view() === "charts" ? [action("charts", "back")] : []),
          ...(selectedRow()
            ? [action("inspect", view() === "details" ? "back" : "details")]
            : []),
          ...(view() !== "charts" && selectedRow()
            ? [action("charts", "charts")]
            : []),
          ...(view() === "overview" && expandable()
            ? [action("expand", "branch")]
            : []),
        ];
    return footerActions(
      [action("help", help() ? "back" : "help"), action("close", "close")],
      optional,
      width(),
    );
  };
  const hint = () => {
    if (help()) return `${shortcut("previous")}/${shortcut("next")} scroll`;
    if (view() === "charts")
      return `${shortcut("refresh")} refresh · ${shortcut("chart-previous")}/${shortcut("chart-next")} metric ${shortcut("previous")}/${shortcut("next")} session ${shortcut("chart-shorter")}/${shortcut("chart-longer")} window`;
    if (view() === "details")
      return `${shortcut("previous")}/${shortcut("next")} scroll · ${shortcut("page-previous")}/${shortcut("page-next")} page`;
    return `${shortcut("previous")}/${shortcut("next")} select · ${shortcut("open")} open · ${inventory().canLoadMore ? shortcut("load-more") + " more" : shortcut("refresh") + " refresh"}`;
  };
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={compact() ? 0 : 1}
      paddingBottom={compact() ? 0 : 1}
      onSizeChange={function () {
        setHeight(this.height);
      }}
    >
      <box flexDirection="column" flexShrink={0}>
        <text fg={props.context.theme.text.base}>
          {clip(
            width() < 28
              ? `${connectionLabel(props.state.connection(), true)} · Guard`
              : `${connectionLabel(props.state.connection())} · Context Guard · ${help() ? "help" : view()}`,
            width(),
          )}
        </text>
        <For each={statusLines()}>
          {(line) => (
            <text
              fg={
                props.state.health()?.enforcement === "suspended" ||
                props.state.health()?.enforcement === "disabled"
                  ? props.context.theme.text.feedback.warning.base
                  : props.context.theme.text.muted
              }
            >
              {line}
            </text>
          )}
        </For>
        <Show when={!["2.0.29", "2.1.2"].includes(props.context.app.version)}>
          <text fg={props.context.theme.text.feedback.warning.base}>
            {clip(`Runtime ${props.context.app.version}: unverified`, width())}
          </text>
        </Show>
        <Show when={notice()}>
          {(message) => (
            <text fg={props.context.theme.text.feedback.warning.base}>
              {clip(message(), width())}
            </text>
          )}
        </Show>
        <Show when={(help() || view() !== "overview") && selectedRow()}>
          {(row) => (
            <text fg={props.context.theme.text.base}>
              {clip(
                `Selected: ${row().node.agent ?? row().node.sessionId}`,
                width(),
              )}
            </text>
          )}
        </Show>
        <Show when={!help() && view() === "overview"}>
          <For
            each={panelSummary(
              selectedRow(),
              width(),
              props.state.age(selected() ?? ""),
              compact(),
            )}
          >
            {(line) => <text fg={props.context.theme.text.base}>{line}</text>}
          </For>
          <text fg={props.context.theme.text.muted}>
            {panelRowHeading(
              `Family ${rows().length ? offset() + 1 : 0}/${rows().length}${props.state.complete() ? "" : " · partial"} · * current`,
              width(),
            )}
          </text>
        </Show>
        <Show when={!help() && view() === "overview"}>
          <For each={inventoryMessages(inventory())}>
            {(line) => (
              <text fg={props.context.theme.text.muted}>
                {clip(line, width())}
              </text>
            )}
          </For>
        </Show>
      </box>
      <scrollbox
        viewportOptions={{
          onSizeChange: function () {
            setViewportWidth(this.width);
          },
        }}
        ref={(value) => {
          scroll = value;
        }}
        flexGrow={1}
        minHeight={0}
        scrollX={false}
      >
        <Show when={help()}>
          <For each={helpLines()}>
            {(line) => <text fg={props.context.theme.text.base}>{line}</text>}
          </For>
        </Show>
        <Show when={!help() && view() === "overview"}>
          <PanelOverview
            rows={rows()}
            selectedId={selected()}
            width={width()}
            context={props.context}
            open={(row) => {
              if (row.hidden) props.state.expand(row.node.sessionId);
              else open(row);
            }}
          />
        </Show>
        <Show when={!help() && view() === "details"}>
          <PanelDetails
            row={selectedRow()}
            rows={rows()}
            routeID={props.input.sessionID}
            familyRows={family().rows}
            familyComplete={family().complete && props.state.complete()}
            trace={trace()}
            width={width()}
            age={props.state.age(selected() ?? "")}
            context={props.context}
            reasons={props.state.health()?.reasons ?? []}
          />
        </Show>
        <Show when={!help() && view() === "charts" && selected()}>
          {(id) => (
            <HistoryCharts
              sessionId={id()}
              windowMs={windows[windowIndex()] ?? 3600000}
              metricIndex={metricIndex()}
              refresh={chartRefresh()}
              width={width()}
              state={props.state}
              context={props.context}
            />
          )}
        </Show>
      </scrollbox>
      <box flexDirection="column" flexShrink={0}>
        <box flexDirection="row" flexShrink={0}>
          <For each={actions()}>
            {(action, index) => (
              <text
                fg={props.context.theme.text.muted}
                onMouseDown={action.run}
              >
                {`${index() ? " " : ""}${action.label}`}
              </text>
            )}
          </For>
        </box>
        <text fg={props.context.theme.text.muted}>{clip(hint(), width())}</text>
      </box>
    </box>
  );
}
