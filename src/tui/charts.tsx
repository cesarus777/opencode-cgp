import { For } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import { historyChartLines } from "./chartformat.ts";
import { historyStatusLines } from "../historyclient.ts";
import type { HistoryView } from "./historystate.ts";
import { wrap } from "./format.ts";
import { panelColors as color, panelAttributes as attr } from "./panelstyle.ts";
export function HistoryCharts(props: {
  sessionId: string;
  windowMs: number;
  metricIndex: number;
  width: number;
  view: HistoryView;
  context: Plugin.Context;
}) {
  const lines = () => {
    const current = props.view.result;
    return current
      ? historyChartLines(
          current,
          Math.max(4, props.width),
          props.view.from ?? 0,
          props.view.to ?? 0,
          props.metricIndex,
        )
      : [];
  };
  return (
    <box flexDirection="column">
      <For each={wrap(`Performance charts · ${props.sessionId}`, props.width)}>
        {(line) => (
          <text fg={color.accent} attributes={attr.BOLD}>
            {line}
          </text>
        )}
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
        {(line) => (
          <text fg={color.text} attributes={attr.DIM}>
            {line}
          </text>
        )}
      </For>
      <For
        each={historyStatusLines(props.view).flatMap((line) =>
          wrap(line, props.width),
        )}
      >
        {(line) => (
          <text fg={color.text} attributes={attr.DIM}>
            {line}
          </text>
        )}
      </For>
      <box flexDirection="column" paddingTop={1}>
        <For each={lines()}>
          {(line) => <text fg={color.text}>{line || " "}</text>}
        </For>
      </box>
    </box>
  );
}
