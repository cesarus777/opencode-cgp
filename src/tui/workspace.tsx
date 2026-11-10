import { For, Index, Show, createMemo, onCleanup } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { GuardRow } from "../family.ts";
import { clip, wrap } from "./format.ts";
import { tokens } from "./quantity.ts";
import {
  compactionLabel,
  measurementLabel,
  pressureLabel,
  thresholdDistance,
} from "./statusformat.ts";
import {
  contextMeter,
  contextOccupancy,
  workspacePerformance,
  workspaceTreeLines,
} from "./workspaceformat.ts";
import { panelColors as color, panelAttributes as attr } from "./panelstyle.ts";

function pressureColor(row: GuardRow | undefined) {
  return row?.freshness !== "fresh" || row.pressure === "unknown"
    ? color.text
    : row.pressure === "crossed"
      ? color.danger
      : row.pressure === "near"
        ? color.warning
        : color.success;
}

export function WorkspaceTree(props: {
  rows: readonly GuardRow[];
  selectedId: string | undefined;
  width: number;
  complete: boolean;
  scrollRef: (value: ScrollBoxRenderable | undefined) => void;
  open: (row: GuardRow) => void;
}) {
  const visible = createMemo(() => {
    const selected = Math.max(
      0,
      props.rows.findIndex((row) => row.node.sessionId === props.selectedId),
    );
    const start = Math.max(0, selected - 10);
    return props.rows
      .slice(start, start + 25)
      .map((row, i) => ({ row, position: start + i }));
  });
  onCleanup(() => props.scrollRef(undefined));
  return (
    <box
      width={props.width}
      minHeight={0}
      flexShrink={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={color.text}
      title=" Session family "
      titleColor={color.accent}
      shouldFill={false}
    >
      <text fg={color.text} attributes={attr.DIM}>
        {clip(
          `${props.rows.length} rows${props.complete ? "" : " · partial"} · * current`,
          props.width - 2,
        )}
      </text>
      <scrollbox
        ref={(value) => props.scrollRef(value)}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollX={false}
      >
        <Show
          when={props.rows.length}
          fallback={<text fg={color.text}>No sessions</text>}
        >
          <Index each={visible()}>
            {(item) => (
              <box
                id={`context-guard.row.${item().row.node.sessionId}`}
                flexDirection="column"
                flexShrink={0}
                onMouseDown={() => props.open(item().row)}
              >
                <Index
                  each={workspaceTreeLines(
                    item().row,
                    item().row.node.sessionId === props.selectedId,
                    item().position,
                    props.width - 3,
                  )}
                >
                  {(line, index) => (
                    <text
                      fg={
                        index === 2 &&
                        (item().row.freshness !== "fresh" ||
                          compactionLabel(item().row))
                          ? color.warning
                          : color.text
                      }
                      attributes={
                        index === 0
                          ? attr.BOLD |
                            (item().row.node.sessionId === props.selectedId
                              ? attr.INVERSE
                              : 0)
                          : index === 2
                            ? attr.DIM
                            : attr.NONE
                      }
                    >
                      <Show when={index === 1} fallback={line() || " "}>
                        <span style={{ fg: pressureColor(item().row) }}>
                          {line().split(" · ")[0]}
                        </span>
                        <span
                          style={{
                            fg:
                              item().row.node.status === "failed"
                                ? color.danger
                                : item().row.node.status === "running"
                                  ? color.success
                                  : color.text,
                          }}
                        >
                          {line().includes(" · ")
                            ? " · " + line().split(" · ").slice(1).join(" · ")
                            : ""}
                        </span>
                      </Show>
                    </text>
                  )}
                </Index>
              </box>
            )}
          </Index>
        </Show>
      </scrollbox>
    </box>
  );
}

export function WorkspaceSummary(props: {
  row: GuardRow | undefined;
  width: number;
  age: number;
  now: number | undefined;
  staleMs: number | undefined;
  live: boolean;
}) {
  const contextWidth = () => Math.floor((props.width - 1) * 0.55);
  const performanceWidth = () => props.width - contextWidth() - 1;
  const valid = () =>
    props.row?.freshness === "fresh" || props.row?.freshness === "stale";
  const performance = createMemo(() =>
    workspacePerformance(props.row, props.now, props.staleMs, props.live),
  );
  const contextLines = () => [
    `${props.row?.freshness === "stale" ? "Last measured " : ""}${contextOccupancy(props.row)} occupied`,
    `${tokens(valid() ? props.row?.snapshot?.measurement?.tokens : undefined)} / ${tokens(props.row?.snapshot?.capacityTokens)} tokens`,
  ];
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={color.text} attributes={attr.BOLD}>
        {clip(
          `${props.row?.node.agent ?? "No selected session"} / ${props.row?.node.model ?? props.row?.snapshot?.model ?? "unknown model"}`,
          props.width,
        )}
      </text>
      <text fg={color.text} attributes={attr.DIM}>
        {clip(
          `Session: ${props.row?.node.sessionId ?? "none"}${props.row?.current ? " (current)" : ""} · ${props.row?.node.status ?? "unknown"}`,
          props.width,
        )}
      </text>
      <box flexDirection="row" gap={1} flexShrink={0} alignItems="stretch">
        <box
          width={contextWidth()}
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={color.text}
          title=" Context "
          titleColor={color.accent}
          shouldFill={false}
          paddingLeft={1}
          paddingRight={1}
        >
          <For each={contextLines()}>
            {(line, index) => (
              <text
                fg={index() === 0 ? pressureColor(props.row) : color.text}
                attributes={index() === 0 ? attr.BOLD : attr.NONE}
              >
                {clip(line, contextWidth() - 4)}
              </text>
            )}
          </For>
          <text fg={color.text}>
            <Show
              when={contextMeter(props.row, contextWidth() - 4)}
              fallback="Context unavailable"
            >
              {(meter) => (
                <For each={meter()}>
                  {(part) => (
                    <span
                      style={{
                        fg: part.active ? pressureColor(props.row) : color.text,
                        dim: !part.active || props.row?.freshness !== "fresh",
                      }}
                    >
                      {part.text}
                    </span>
                  )}
                </For>
              )}
            </Show>
          </text>
          <text fg={color.text} attributes={attr.DIM}>
            {clip(
              `┆ trigger ${tokens(props.row?.snapshot?.policy.triggerTokens)}`,
              contextWidth() - 4,
            )}
          </text>
          <text fg={pressureColor(props.row)}>
            {clip(pressureLabel(props.row), contextWidth() - 4)}
          </text>
          <For each={wrap(thresholdDistance(props.row), contextWidth() - 4)}>
            {(line) => <text fg={color.text}>{line}</text>}
          </For>
          <For
            each={wrap(
              measurementLabel(props.row, props.age),
              contextWidth() - 4,
            )}
          >
            {(line) => (
              <text fg={color.text} attributes={attr.DIM}>
                {line}
              </text>
            )}
          </For>
        </box>
        <box
          width={performanceWidth()}
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={color.text}
          title=" Performance "
          titleColor={color.accent}
          shouldFill={false}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={color.accent} attributes={attr.BOLD}>
            {clip(`${performance().live} live TPS`, performanceWidth() - 4)}
          </text>
          <text fg={color.text}>
            {clip(`${performance().ttft} TTFT`, performanceWidth() - 4)}
          </text>
          <text fg={color.text}>
            {clip(
              `${performance().model} model avg TPS`,
              performanceWidth() - 4,
            )}
          </text>
          <text fg={color.text}>
            {clip(
              `${performance().session} session avg TPS`,
              performanceWidth() - 4,
            )}
          </text>
          <text fg={color.text} attributes={attr.DIM}>
            {clip(performance().status, performanceWidth() - 4)}
          </text>
          <text fg={color.text} attributes={attr.DIM}>
            {clip(
              performance().partial
                ? "Partial timing coverage"
                : "~ approximate / estimated",
              performanceWidth() - 4,
            )}
          </text>
        </box>
      </box>
      <For
        each={wrap(
          compactionLabel(props.row) ?? "No compaction request in progress.",
          props.width,
        )}
      >
        {(line) => (
          <text
            fg={
              props.row?.snapshot?.compaction.phase === "idle"
                ? color.text
                : color.warning
            }
          >
            {line}
          </text>
        )}
      </For>
      <text fg={color.text} attributes={attr.DIM}>
        {clip(
          `Completed compactions: ${tokens(props.row?.snapshot?.compaction.count)} · admission is not completion`,
          props.width,
        )}
      </text>
    </box>
  );
}
