import { For, createEffect, createMemo, onCleanup, Show } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardState } from "./state.ts";
import type { GuardRow } from "../family.ts";
import { detailLines, rowLines, clip, wrap } from "./format.ts";
import { contextChart } from "./contextchart.ts";
import { CompactSidebar } from "./compact.tsx";
export function GuardView(props: {
  sessionID: string;
  state: GuardState;
  context: Plugin.Context;
  width: number;
  expanded?: boolean;
  family?: readonly GuardRow[];
  selectedId?: string;
  inspectId?: string | undefined;
}) {
  const consumer = props.state.acquire(props.sessionID);
  createEffect(() => consumer.update(props.sessionID));
  onCleanup(() => consumer.release());
  const rows = createMemo(
    () => props.family ?? props.state.rows([], !props.expanded),
  );
  const current = createMemo(() =>
    rows().find((row) => row.node.sessionId === props.sessionID),
  );
  const trace = createMemo(() =>
    props.state.contextTrace(props.expanded ? current() : undefined),
  );
  const chart = createMemo(() =>
    contextChart(
      trace().samples,
      current()?.snapshot?.capacityTokens ?? trace().capacity,
      current()?.snapshot?.policy.triggerTokens,
      props.width,
      current()?.snapshot?.measurement
        ? (current()?.snapshot?.measurement?.at ?? 0) +
            props.state.age(props.sessionID)
        : undefined,
    ),
  );
  const detail = createMemo(() => {
    const lines = detailLines(
      current(),
      props.width,
      props.expanded,
      props.state.age(props.sessionID),
    );
    if (props.expanded) {
      const byId = new Map(rows().map((row) => [row.node.sessionId, row.node]));
      const ancestry: string[] = [],
        seen = new Set<string>();
      let node = byId.get(props.sessionID);
      while (node && !seen.has(node.sessionId)) {
        seen.add(node.sessionId);
        ancestry.unshift(node.agent ?? node.sessionId);
        node = node.parentId ? byId.get(node.parentId) : undefined;
      }
      lines.push(...wrap(`Ancestry: ${ancestry.join(" / ")}`, props.width));
    }
    if (props.inspectId && props.inspectId !== props.sessionID) {
      const inspected = rows().find(
        (row) => row.node.sessionId === props.inspectId,
      );
      lines.push(
        ...wrap(`Inspect: ${props.inspectId}`, props.width),
        ...detailLines(
          inspected,
          props.width,
          true,
          props.state.age(props.inspectId),
        ),
      );
    }
    return lines;
  });
  const visible = createMemo(() => {
    if (!props.expanded) return rows().slice(0, 7);
    const index = Math.max(
      0,
      rows().findIndex((row) => row.node.sessionId === props.selectedId),
    );
    return rows().slice(Math.max(0, index - 10), Math.max(0, index - 10) + 25);
  });
  return (
    <Show
      when={props.expanded}
      fallback={
        <CompactSidebar
          sessionID={props.sessionID}
          state={props.state}
          context={props.context}
          rows={rows()}
          width={props.width}
        />
      }
    >
      <box flexDirection="column" gap={0}>
        <text fg={props.context.theme.text.base}>
          Context Guard / {props.state.health()?.mode ?? "?"}
        </text>
        <text fg={props.context.theme.text.muted}>
          {["2.0.29", "2.1.2"].includes(props.context.app.version)
            ? ""
            : clip(
                `Runtime ${props.context.app.version}: unverified (tested: 2.0.29, 2.1.2)`,
                props.width,
              )}
        </text>
        <text fg={props.context.theme.text.muted}>
          {clip(
            `${props.state.connection()} / ${props.state.health()?.enforcement ?? "?"}`,
            props.width,
          )}
        </text>
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
                          part.tone === "axis" || part.tone === "held"
                            ? props.context.theme.text.muted
                            : part.tone === "threshold"
                              ? props.context.theme.text.feedback.warning.base
                              : current()?.freshness === "fresh"
                                ? props.context.theme.text.base
                                : props.context.theme.text.muted,
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
            "Recent context samples → now · ┄ trigger · ┈ held",
            props.width,
          )}
        >
          {(line) => <text fg={props.context.theme.text.muted}>{line}</text>}
        </For>
        <For each={detail()}>
          {(line) => <text fg={props.context.theme.text.base}>{line}</text>}
        </For>
        <For each={props.state.health()?.reasons ?? []}>
          {(reason) => (
            <text fg={props.context.theme.text.feedback.warning.base}>
              {clip(reason, props.width)}
            </text>
          )}
        </For>
        <text fg={props.context.theme.text.muted}>
          {props.state.health()?.mode === "observe"
            ? current()?.pressure === "crossed"
              ? "Observe: would compact"
              : "Observe: no admission"
            : ""}
        </text>
        <text fg={props.context.theme.text.base}>
          Family ({rows().length}){props.state.complete() ? "" : " partial"}
        </text>
        <For each={visible()}>
          {(row) => (
            <box
              id={`context-guard.row.${row.node.sessionId}`}
              flexDirection="column"
              onMouseDown={() => {
                if (row.hidden) props.state.expand(row.node.sessionId);
                else {
                  if (props.expanded) props.context.ui.panel.close();
                  props.context.ui.router.navigate({
                    type: "session",
                    sessionID: row.node.sessionId,
                  });
                }
              }}
            >
              <For
                each={rowLines(
                  row,
                  Math.max(1, props.width - (props.expanded ? 2 : 0)),
                ).map((line) =>
                  props.expanded
                    ? `${row.node.sessionId === props.selectedId ? ">" : " "} ${line}`
                    : line,
                )}
              >
                {(line) => (
                  <text
                    fg={
                      row.pressure === "crossed"
                        ? props.context.theme.text.feedback.error.base
                        : row.pressure === "near"
                          ? props.context.theme.text.feedback.warning.base
                          : props.context.theme.text.base
                    }
                  >
                    {line}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
        <text
          fg={props.context.theme.text.muted}
          onMouseDown={() =>
            props.context.ui.panel.open("context-guard.monitor")
          }
        >
          {rows().length > visible().length
            ? `+ ${rows().length - visible().length} rows; open panel`
            : "Open: /context-guard"}
        </text>
      </box>
    </Show>
  );
}
