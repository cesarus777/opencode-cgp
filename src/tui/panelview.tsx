import { For, Index, Show, createMemo } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardRow } from "../family.ts";
import type { ContextTrace } from "./contextchart.ts";
import { contextChart } from "./contextchart.ts";
import { detailLines, wrap } from "./format.ts";
import { panelRowLines } from "./panelformat.ts";

export function PanelOverview(props: {
  rows: readonly GuardRow[];
  selectedId: string | undefined;
  width: number;
  context: Plugin.Context;
  open: (row: GuardRow) => void;
}) {
  const visible = createMemo(() => {
    const index = Math.max(
      0,
      props.rows.findIndex((row) => row.node.sessionId === props.selectedId),
    );
    const start = Math.max(0, index - 10);
    return props.rows.slice(start, start + 25);
  });
  return (
    <Index each={visible()}>
      {(row) => (
        <box
          id={`context-guard.row.${row().node.sessionId}`}
          flexDirection="column"
          flexShrink={0}
          onMouseDown={() => props.open(row())}
        >
          <Index
            each={panelRowLines(
              row(),
              props.width,
              row().node.sessionId === props.selectedId,
            )}
          >
            {(line) => (
              <text
                fg={
                  row().pressure === "crossed" || row().node.status === "failed"
                    ? props.context.theme.text.feedback.error.base
                    : row().pressure === "near"
                      ? props.context.theme.text.feedback.warning.base
                      : props.context.theme.text.base
                }
              >
                {line()}
              </text>
            )}
          </Index>
        </box>
      )}
    </Index>
  );
}

export function PanelDetails(props: {
  row: GuardRow | undefined;
  rows: readonly GuardRow[];
  trace: ContextTrace;
  width: number;
  age: number;
  context: Plugin.Context;
  reasons: readonly string[];
}) {
  const chart = createMemo(() =>
    contextChart(
      props.trace.samples,
      props.row?.snapshot?.capacityTokens ?? props.trace.capacity,
      props.row?.snapshot?.policy.triggerTokens,
      props.width,
      props.row?.snapshot?.measurement
        ? props.row.snapshot.measurement.at + props.age
        : undefined,
    ),
  );
  const detail = createMemo(() => {
    const row = props.row;
    if (!row) return ["No selected session; return to Overview."];
    const byId = new Map(props.rows.map((r) => [r.node.sessionId, r.node]));
    const ancestry: string[] = [],
      seen = new Set<string>();
    let node = row.node;
    while (!seen.has(node.sessionId)) {
      seen.add(node.sessionId);
      ancestry.unshift(node.agent ?? node.sessionId);
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (!parent) break;
      node = parent;
    }
    return [
      `Session: ${row.node.sessionId}${row.current ? " (current)" : ""}`,
      ...detailLines(row, props.width, true, props.age),
      `Ancestry: ${ancestry.join(" / ")}`,
      ...props.reasons,
      "Guard input = prompt + caches. Native Context uses different totals.",
    ].flatMap((line) => wrap(line, props.width));
  });
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={props.context.theme.text.base}>Context history</text>
      <For each={chart()}>
        {(item) => (
          <text
            fg={
              item.threshold
                ? props.context.theme.text.feedback.warning.base
                : props.context.theme.text.muted
            }
          >
            <Show when={item.segments} fallback={item.line}>
              <For each={item.segments}>
                {(part) => (
                  <span
                    style={{
                      fg:
                        part.tone === "threshold"
                          ? props.context.theme.text.feedback.warning.base
                          : part.tone === "axis" ||
                              part.tone === "held" ||
                              props.row?.freshness !== "fresh"
                            ? props.context.theme.text.muted
                            : props.context.theme.text.base,
                    }}
                  >
                    {part.text}
                  </span>
                )}
              </For>
            </Show>
          </text>
        )}
      </For>
      <For
        each={wrap(
          "Recent samples → now · ┄ trigger · muted held",
          props.width,
        )}
      >
        {(line) => <text fg={props.context.theme.text.muted}>{line}</text>}
      </For>
      <For each={detail()}>
        {(line) => <text fg={props.context.theme.text.base}>{line}</text>}
      </For>
    </box>
  );
}
