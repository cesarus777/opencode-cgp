import { For, Index, Show, createMemo } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardRow } from "../family.ts";
import type { ContextTrace } from "./contextchart.ts";
import { contextChart } from "./contextchart.ts";
import { detailLines, wrap } from "./format.ts";
import { statistics } from "./compactformat.ts";
import { contextHistoryLegend, reasonExplanation } from "./statusformat.ts";
import { panelRowLines } from "./panelformat.ts";
import { panelColors as color, panelAttributes as attr } from "./panelstyle.ts";

export function PanelOverview(props: {
  rows: readonly GuardRow[];
  selectedId: string | undefined;
  width: number;
  context: Plugin.Context;
  open: (row: GuardRow) => void;
  displayRow: (row: GuardRow) => GuardRow;
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
              props.displayRow(row()),
              props.width,
              row().node.sessionId === props.selectedId,
            )}
          >
            {(line, index) => (
              <text
                attributes={
                  index === 0 && row().node.sessionId === props.selectedId
                    ? attr.BOLD | attr.INVERSE
                    : attr.NONE
                }
                fg={
                  row().pressure === "crossed" || row().node.status === "failed"
                    ? color.danger
                    : row().pressure === "near"
                      ? color.warning
                      : color.text
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
  routeID: string;
  familyRows: readonly GuardRow[];
  familyComplete: boolean;
  trace: ContextTrace;
  width: number;
  age: number;
  context: Plugin.Context;
  reasons: readonly string[];
  displayRow: (row: GuardRow) => GuardRow;
}) {
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
      ...(props.displayRow(row) !== row
        ? ["Performance readings stale or unavailable; current rates unknown."]
        : []),
      ...detailLines(props.displayRow(row), props.width, true, props.age),
      `Ancestry: ${ancestry.join(" / ")}`,
      ...props.reasons.flatMap((reason) => [
        reasonExplanation(reason),
        `Health reason code: ${reason}`,
      ]),
      `Route family statistics: ${props.routeID}${props.familyComplete ? "" : " · partial"}`,
      ...statistics(
        props.familyRows,
        props.routeID,
        props.familyComplete,
        props.width,
      ),
      "Guard input = prompt + caches. Native Context uses different totals.",
    ].flatMap((line) => wrap(line, props.width));
  });
  return (
    <box flexDirection="column" flexShrink={0}>
      <PanelContextHistory
        row={props.row}
        trace={props.trace}
        width={props.width}
        age={props.age}
      />
      <For each={detail()}>{(line) => <text fg={color.text}>{line}</text>}</For>
    </box>
  );
}

export function PanelContextHistory(props: {
  row: GuardRow | undefined;
  trace: ContextTrace;
  width: number;
  age: number;
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
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={color.accent} attributes={attr.BOLD}>
        Context history
      </text>
      <For each={chart()}>
        {(item) => (
          <text fg={item.threshold ? color.warning : color.text}>
            <Show when={item.segments} fallback={item.line}>
              <For each={item.segments}>
                {(part) => (
                  <span
                    style={{
                      dim:
                        part.tone === "held" ||
                        part.tone === "axis" ||
                        props.row?.freshness !== "fresh",
                      fg:
                        part.tone === "threshold" ? color.warning : color.text,
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
        each={contextHistoryLegend.flatMap((line) => wrap(line, props.width))}
      >
        {(line) => (
          <text fg={color.text} attributes={attr.DIM}>
            {line}
          </text>
        )}
      </For>
    </box>
  );
}
