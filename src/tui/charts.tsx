import { createEffect, createSignal, on, onCleanup, For } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardState } from "./state.ts";
import { historyChartLines } from "./chartformat.ts";
import { historyStatusLines } from "../historyclient.ts";
import { HistoryState, type HistoryView } from "./historystate.ts";
import { wrap } from "./format.ts";
export function HistoryCharts(props: {
  sessionId: string;
  windowMs: number;
  metricIndex: number;
  refresh: number;
  width: number;
  state: GuardState;
  context: Plugin.Context;
}) {
  const [view, setView] = createSignal<HistoryView>({
    status: "loading",
    stale: false,
  });
  const history = new HistoryState({
    read: (id, from, to, signal) => props.state.history(id, from, to, signal),
    changed: setView,
  });
  createEffect(
    on(
      () =>
        [
          props.sessionId,
          props.windowMs,
          props.state.historyLocation(props.sessionId),
        ] as const,
      ([sessionId, windowMs, location]) =>
        history.setQuery({ sessionId, windowMs, location }),
    ),
  );
  createEffect(
    on(
      () => props.refresh,
      () => history.refresh(),
      { defer: true },
    ),
  );
  onCleanup(() => history.dispose());
  const lines = () => {
    const current = view().result;
    return current
      ? historyChartLines(
          current,
          Math.max(4, props.width),
          view().from ?? 0,
          view().to ?? 0,
          props.metricIndex,
        )
      : [];
  };
  return (
    <box flexDirection="column">
      <For each={wrap(`Performance charts · ${props.sessionId}`, props.width)}>
        {(line) => <text fg={props.context.theme.text.base}>{line}</text>}
      </For>
      <For
        each={wrap(
          `Window: ${
            new Map([
              [300000, "5 minutes"],
              [3600000, "1 hour"],
              [86400000, "24 hours"],
              [604800000, "7 days"],
            ]).get(props.windowMs) ?? `${props.windowMs / 60000} minutes`
          } · [ / ] changes`,
          props.width,
        )}
      >
        {(line) => <text fg={props.context.theme.text.muted}>{line}</text>}
      </For>
      <For
        each={historyStatusLines(view()).flatMap((line) =>
          wrap(line, props.width),
        )}
      >
        {(line) => <text fg={props.context.theme.text.muted}>{line}</text>}
      </For>
      <box flexDirection="column" paddingTop={1}>
        <For each={lines()}>
          {(line) => (
            <text fg={props.context.theme.text.base}>{line || " "}</text>
          )}
        </For>
      </box>
    </box>
  );
}
