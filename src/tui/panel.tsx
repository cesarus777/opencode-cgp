import type { ScrollBoxRenderable } from "@opentui/core";
import type { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
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
import { PanelDetails, PanelOverview } from "./panelview.tsx";
import {
  compactionLabel,
  panelRowHeading,
  panelSummary,
} from "./panelformat.ts";
import { chartMetrics } from "./chartformat.ts";
import { clip, wrap } from "./format.ts";
import { connectionLabel, monitorStatusLines } from "./statusformat.ts";

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
  function revealSelection() {
    if (!props.context.renderer) return;
    cancelFollow();
    let frames = 0;
    follow = async () => {
      scroll?.scrollChildIntoView(`context-guard.row.${selected()}`);
      if (++frames >= 2) cancelFollow();
      else props.context.renderer.requestRender();
    };
    props.context.renderer.setFrameCallback(follow);
    props.context.renderer.requestRender();
  }
  onCleanup(cancelFollow);
  createEffect(() => {
    view();
    selected();
    rows();
    width();
    height();
    if (view() === "overview") revealSelection();
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
    if (view() === "overview")
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
    if (view() === "overview") move(last ? rows().length : -rows().length);
    else scroll?.scrollTo(last ? scroll.scrollHeight : 0);
  }
  props.context.keymap.layer(() => ({
    enabled: () => props.input.focused,
    commands: [
      {
        id: "context-guard.close",
        title: "Close Context Guard",
        bind: "q",
        run: () => props.input.close(),
      },
      {
        id: "context-guard.chart-previous",
        title: "Previous chart metric",
        bind: "left",
        run: () => {
          if (view() === "charts")
            setMetricIndex(
              (i) => (i + chartMetrics.length - 1) % chartMetrics.length,
            );
        },
      },
      {
        id: "context-guard.chart-next",
        title: "Next chart metric",
        bind: "right",
        run: () => {
          if (view() === "charts")
            setMetricIndex((i) => (i + 1) % chartMetrics.length);
        },
      },
      {
        id: "context-guard.charts",
        title: "Toggle performance charts",
        bind: "c",
        run: () => changeView(view() === "charts" ? "overview" : "charts"),
      },
      {
        id: "context-guard.chart-shorter",
        title: "Shorter chart window",
        bind: "[",
        run: () => {
          if (view() === "charts") setWindowIndex((i) => Math.max(0, i - 1));
        },
      },
      {
        id: "context-guard.chart-longer",
        title: "Longer chart window",
        bind: "]",
        run: () => {
          if (view() === "charts")
            setWindowIndex((i) => Math.min(windows.length - 1, i + 1));
        },
      },
      {
        id: "context-guard.inspect",
        title: "Toggle selected session details",
        bind: "i",
        run: () => changeView(view() === "details" ? "overview" : "details"),
      },
      {
        id: "context-guard.refresh",
        title: "Refresh Context Guard",
        bind: "r",
        run: () => {
          setOrder([]);
          props.state.refresh();
          setChartRefresh((n) => n + 1);
        },
      },
      {
        id: "context-guard.load-more",
        title: "Load more family",
        bind: "l",
        run: () => {
          if (view() === "overview" && !props.state.complete())
            props.state.loadMore();
        },
      },
      {
        id: "context-guard.next",
        bind: "down",
        run: () => (view() === "details" ? scroll?.scrollBy(1) : move(1)),
      },
      {
        id: "context-guard.previous",
        bind: "up",
        run: () => (view() === "details" ? scroll?.scrollBy(-1) : move(-1)),
      },
      {
        id: "context-guard.page-next",
        title: "Next page",
        bind: "pagedown",
        run: () => page(1),
      },
      {
        id: "context-guard.page-previous",
        title: "Previous page",
        bind: "pageup",
        run: () => page(-1),
      },
      {
        id: "context-guard.first",
        title: "First row or top",
        bind: "home",
        run: () => edge(false),
      },
      {
        id: "context-guard.last",
        title: "Last row or bottom",
        bind: "end",
        run: () => edge(true),
      },
      {
        id: "context-guard.expand",
        bind: "space",
        run: () => {
          const row = selectedRow();
          if (view() === "overview" && row)
            props.state.expand(row.node.sessionId);
        },
      },
      {
        id: "context-guard.open",
        bind: "return",
        run: () => open(selectedRow()),
      },
    ],
  }));
  const statusLines = () =>
    monitorStatusLines(
      props.state.connection(),
      props.state.health(),
      rows().some((row) => row.snapshot?.measurement !== undefined),
      width() < 28,
    ).flatMap((line) => wrap(line, width()));
  const notice = () => compactionLabel(selectedRow());
  const actions = () => {
    const info = {
      label:
        view() === "details" ? "i back" : width() < 28 ? "i info" : "i details",
      run: () => changeView(view() === "details" ? "overview" : "details"),
    };
    const charts = {
      label: view() === "charts" ? "c back" : "c charts",
      run: () => changeView(view() === "charts" ? "overview" : "charts"),
    };
    return [
      ...(width() < 28
        ? [view() === "charts" ? charts : info]
        : view() === "charts"
          ? [charts, info]
          : [info, charts]),
      { label: "q close", run: () => props.input.close() },
    ];
  };
  const hint = () =>
    width() < 28
      ? view() === "details"
        ? "↑↓ scroll c chart"
        : "↑↓ pick c chart"
      : view() === "charts"
        ? "←/→ metric ↑↓ session [/] window"
        : view() === "details"
          ? "↑↓ scroll · PgUp/PgDn · r refresh"
          : !props.state.complete()
            ? "↑↓ select · Enter open · l more"
            : "↑↓ select · Enter open · r refresh";
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
              : `${connectionLabel(props.state.connection())} · Context Guard · ${view()}`,
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
        <Show when={view() !== "overview" && selectedRow()}>
          {(row) => (
            <text fg={props.context.theme.text.base}>
              {clip(
                `Selected: ${row().node.agent ?? row().node.sessionId}`,
                width(),
              )}
            </text>
          )}
        </Show>
        <Show when={view() === "overview"}>
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
        <Show when={view() === "overview"}>
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
        <Show when={view() === "details"}>
          <PanelDetails
            row={selectedRow()}
            rows={rows()}
            trace={trace()}
            width={width()}
            age={props.state.age(selected() ?? "")}
            context={props.context}
            reasons={props.state.health()?.reasons ?? []}
          />
        </Show>
        <Show when={view() === "charts" && selected()}>
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
                {`${index() ? " · " : ""}${action.label}`}
              </text>
            )}
          </For>
        </box>
        <text fg={props.context.theme.text.muted}>{clip(hint(), width())}</text>
      </box>
    </box>
  );
}
