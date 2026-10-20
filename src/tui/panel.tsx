import type { ScrollBoxRenderable } from "@opentui/core";
import type { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import {
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  Show,
  For,
} from "solid-js";
import type { GuardState } from "./state.ts";
import { HistoryCharts } from "./charts.tsx";
import { GuardView } from "./sidebar.tsx";
import { chartMetrics } from "./chartformat.ts";
import { wrap } from "./format.ts";
export function GuardPanel(props: {
  input: PanelInput;
  state: GuardState;
  context: Plugin.Context;
}) {
  const [showCharts, setShowCharts] = createSignal(false);
  const [metricIndex, setMetricIndex] = createSignal(0);
  const width = () => Math.max(4, props.input.width - 4);
  const windows = [300000, 3600000, 86400000, 7 * 86400000];
  const [windowIndex, setWindowIndex] = createSignal(1);
  const [chartRefresh, setChartRefresh] = createSignal(0);
  const [inspectId, setInspectId] = createSignal<string>();
  const [selected, setSelected] = createSignal(props.input.sessionID);
  const [order, setOrder] = createSignal<readonly string[]>([]);
  const rows = createMemo(() => props.state.rows(order()));
  const offset = () =>
    Math.max(
      0,
      rows().findIndex((row) => row.node.sessionId === selected()),
    );
  createEffect(() => {
    if (!props.input.focused) setOrder([]);
  });
  createEffect(() => {
    setSelected(props.input.sessionID);
    setOrder([]);
  });
  let scroll: ScrollBoxRenderable | undefined;
  let follow: ((deltaTime: number) => Promise<void>) | undefined;
  function revealSelection() {
    if (follow) props.context.renderer.removeFrameCallback(follow);
    let frames = 0;
    follow = async () => {
      scroll?.scrollChildIntoView(`context-guard.row.${selected()}`);
      if (++frames >= 2 && follow) {
        props.context.renderer.removeFrameCallback(follow);
        follow = undefined;
      } else props.context.renderer.requestRender();
    };
    props.context.renderer.setFrameCallback(follow);
    props.context.renderer.requestRender();
  }
  onCleanup(() => {
    if (follow) props.context.renderer.removeFrameCallback(follow);
  });
  function move(delta: number) {
    setOrder(rows().map((row) => row.node.sessionId));
    const row =
      rows()[Math.max(0, Math.min(rows().length - 1, offset() + delta))];
    if (row) {
      setSelected(row.node.sessionId);
      if (!showCharts()) revealSelection();
    }
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
          if (showCharts())
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
          if (showCharts())
            setMetricIndex((i) => (i + 1) % chartMetrics.length);
        },
      },
      {
        id: "context-guard.charts",
        title: "Toggle performance charts",
        bind: "c",
        run: () => setShowCharts((v) => !v),
      },
      {
        id: "context-guard.chart-shorter",
        title: "Shorter chart window",
        bind: "[",
        run: () => {
          if (showCharts()) setWindowIndex((i) => Math.max(0, i - 1));
        },
      },
      {
        id: "context-guard.chart-longer",
        title: "Longer chart window",
        bind: "]",
        run: () => {
          if (showCharts())
            setWindowIndex((i) => Math.min(windows.length - 1, i + 1));
        },
      },
      {
        id: "context-guard.inspect",
        title: "Inspect selected session",
        bind: "i",
        run: () =>
          setInspectId(inspectId() === selected() ? undefined : selected()),
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
        run: () => props.state.loadMore(),
      },
      {
        id: "context-guard.next",
        bind: "down",
        run: () => move(1),
      },
      {
        id: "context-guard.previous",
        bind: "up",
        run: () => move(-1),
      },
      {
        id: "context-guard.expand",
        bind: "space",
        run: () => {
          const row = rows()[offset()];
          if (row) props.state.expand(row.node.sessionId);
        },
      },
      {
        id: "context-guard.open",
        bind: "return",
        run: () => {
          const row = rows()[offset()];
          if (row) {
            props.input.close();
            props.context.ui.router.navigate({
              type: "session",
              sessionID: row.node.sessionId,
            });
          }
        },
      },
    ],
  }));
  const hints = () =>
    showCharts()
      ? [
          "c back · q close",
          "← / → metric · ↑ / ↓ session",
          `[ / ] window · ${["5 minutes", "1 hour", "24 hours", "7 days"][windowIndex()]}`,
          "r refresh · Enter open session",
        ]
      : [
          "c charts · q close",
          `↑ / ↓ select ${offset() + 1} · Enter open`,
          "space expand · i inspect",
          "r refresh · l load more",
        ];
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <scrollbox
        ref={(value) => {
          scroll = value;
        }}
        flexGrow={1}
        minHeight={0}
      >
        <box visible={!showCharts()} flexDirection="column">
          <GuardView
            sessionID={props.input.sessionID}
            state={props.state}
            context={props.context}
            width={width()}
            expanded
            family={rows()}
            selectedId={selected()}
            inspectId={inspectId()}
          />
          <text fg={props.context.theme.text.muted}>
            {wrap(
              "Guard input = prompt + caches. Native Context uses different totals.",
              width(),
            ).join("\n")}
          </text>
        </box>
        <Show when={showCharts()}>
          <HistoryCharts
            sessionId={selected()}
            windowMs={windows[windowIndex()] ?? 3600000}
            metricIndex={metricIndex()}
            refresh={chartRefresh()}
            width={width()}
            state={props.state}
            context={props.context}
          />
        </Show>
      </scrollbox>
      <box flexDirection="column" flexShrink={0} paddingTop={1}>
        <For each={hints().flatMap((hint) => wrap(hint, width()))}>
          {(line) => <text fg={props.context.theme.text.muted}>{line}</text>}
        </For>
      </box>
    </box>
  );
}
