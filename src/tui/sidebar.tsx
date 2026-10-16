import { For, createEffect, createMemo, onCleanup } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardState } from "./state.ts";
import type { GuardRow } from "../family.ts";
import { detailLines, rowLines, clip, wrap } from "./format.ts";
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
  const rows = createMemo(() => props.family ?? props.state.rows());
  const current = createMemo(() =>
    rows().find((row) => row.node.sessionId === props.sessionID),
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
    <box flexDirection="column" gap={0}>
      <text fg={props.context.theme.text.base}>
        Context Guard / {props.state.health()?.mode ?? "?"}
      </text>
      <text fg={props.context.theme.text.muted}>
        {props.context.app.version === "2.0.29"
          ? ""
          : clip(
              `Runtime ${props.context.app.version}: unverified (2.0.29 target)`,
              props.width,
            )}
      </text>
      <text fg={props.context.theme.text.muted}>
        {clip(
          `${props.state.connection()} / ${props.state.health()?.enforcement ?? "?"}`,
          props.width,
        )}
      </text>
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
        onMouseDown={() => props.context.ui.panel.open("context-guard.monitor")}
      >
        {rows().length > visible().length
          ? `+ ${rows().length - visible().length} rows; open panel`
          : "Open: /context-guard"}
      </text>
    </box>
  );
}
