import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardRow } from "../family.ts";
import type { GuardState } from "./state.ts";
import { cells, clip, wrap } from "./format.ts";
import {
  agentLines,
  agentHeading,
  mainSections,
  statistics,
  subagentTree,
} from "./compactformat.ts";

export function CompactSidebar(props: {
  sessionID: string;
  rows: readonly GuardRow[];
  state: GuardState;
  context: Plugin.Context;
  width: number;
}) {
  const [measuredWidth, setMeasuredWidth] = createSignal(props.width);
  const width = () => Math.max(1, Math.min(props.width, measuredWidth()) - 4);
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [hideCompleted, setHideCompleted] = createSignal(false);
  const [byPressure, setByPressure] = createSignal(true);
  createEffect(() => {
    props.sessionID;
    setCollapsed(new Set<string>());
  });
  const current = createMemo(() =>
    props.rows.find((r) => r.node.sessionId === props.sessionID),
  );
  const trace = createMemo(() => props.state.contextTrace(current()));
  const tree = createMemo(() =>
    subagentTree(
      props.rows,
      props.sessionID,
      collapsed(),
      hideCompleted(),
      byPressure(),
    ),
  );
  const entries = createMemo(
    () =>
      new Map(tree().visible.map((entry) => [entry.row.node.sessionId, entry])),
  );
  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleCompleted = () => setHideCompleted((value) => !value);
  const toggleSort = () => setByPressure((value) => !value);
  const toggleGroups = () =>
    setCollapsed((previous) =>
      previous.size
        ? new Set<string>()
        : new Set(tree().all.map((r) => r.node.sessionId)),
    );
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "context-guard.completed",
        title: "Toggle completed subagents",
        group: "Context Guard",
        palette: true,
        bind: false,
        run: () => {
          toggleCompleted();
        },
      },
      {
        id: "context-guard.sort",
        title: "Toggle subagent pressure sorting",
        group: "Context Guard",
        palette: true,
        bind: false,
        run: () => {
          toggleSort();
        },
      },
      {
        id: "context-guard.groups",
        title: "Collapse or expand subagent groups",
        group: "Context Guard",
        palette: true,
        bind: false,
        run: () => {
          toggleGroups();
        },
      },
    ],
  }));
  const colors = () => props.context.theme.text;
  const executionColor = (row: GuardRow | undefined) =>
    row?.node.status === "running"
      ? colors().feedback.success.base
      : row?.node.status === "failed"
        ? colors().feedback.error.base
        : colors().muted;
  const pressureColor = (row: GuardRow | undefined) =>
    row?.freshness !== "fresh" || row.pressure === "unknown"
      ? colors().muted
      : row.pressure === "crossed"
        ? colors().feedback.error.base
        : row.pressure === "near"
          ? colors().feedback.warning.base
          : colors().feedback.success.base;
  const rowColor = (row: GuardRow) =>
    row.node.status === "failed"
      ? colors().feedback.error.base
      : row.node.status === "completed" && row.pressure === "normal"
        ? colors().muted
        : pressureColor(row);
  function Lines(input: { lines: readonly string[] }) {
    return (
      <Index each={input.lines}>
        {(line) => <text fg={colors().base}>{line() || " "}</text>}
      </Index>
    );
  }
  const section = (title: string) => {
    const head = cells(`── ${title} `) > width() ? title : `── ${title} `;
    return clip(head, width()) + "─".repeat(Math.max(0, width() - cells(head)));
  };
  const notices = createMemo(() => [
    ...(!["2.0.29", "2.1.2"].includes(props.context.app.version)
      ? wrap(`Runtime ${props.context.app.version}: unverified`, width())
      : []),
    ...(props.state.connection() !== "live"
      ? wrap(`Connection: ${props.state.connection()}`, width())
      : []),
    ...(props.state.health()?.mode === "observe" ? ["Observe mode"] : []),
    ...(props.state.health()?.enforcement === "disabled" ||
    props.state.health()?.enforcement === "suspended"
      ? wrap(`Guard: ${props.state.health()?.enforcement}`, width())
      : []),
    ...(props.state.health()?.reasons ?? []).flatMap((reason) =>
      wrap(reason, width()),
    ),
  ]);
  return (
    <box
      width="100%"
      maxWidth={props.width}
      flexShrink={0}
      border
      borderStyle="rounded"
      title=" CONTEXT GUARD "
      borderColor={colors().muted}
      titleColor={colors().base}
      paddingX={1}
      flexDirection="column"
      onSizeChange={function () {
        setMeasuredWidth(this.width);
      }}
    >
      <Index
        each={mainSections(
          current(),
          width(),
          props.state.age(props.sessionID),
          trace().samples,
          trace().capacity,
        )}
      >
        {(section) => (
          <Index each={section().lines}>
            {(line) => (
              <text
                fg={
                  section().tone === "execution"
                    ? executionColor(current())
                    : section().tone === "threshold"
                      ? colors().feedback.warning.base
                      : section().tone === "pressure"
                        ? pressureColor(current())
                        : section().tone === "measurement"
                          ? current()?.freshness === "fresh"
                            ? colors().muted
                            : colors().feedback.warning.base
                          : colors().base
                }
              >
                <Show when={section().segments} fallback={line() || " "}>
                  <For each={section().segments}>
                    {(part) => (
                      <span
                        style={{
                          fg:
                            part.tone === "axis" || part.tone === "held"
                              ? colors().muted
                              : part.tone === "threshold"
                                ? colors().feedback.warning.base
                                : current()?.freshness === "fresh"
                                  ? colors().base
                                  : colors().muted,
                        }}
                      >
                        {part.text}
                      </span>
                    )}
                  </For>
                </Show>
              </text>
            )}
          </Index>
        )}
      </Index>
      <Index each={notices()}>
        {(line) => <text fg={colors().feedback.warning.base}>{line()}</text>}
      </Index>
      <text> </text>
      <text fg={colors().muted}>
        {section(`SUBAGENTS (${tree().all.length})`)}
      </text>
      <Lines
        lines={wrap(
          `${tree().all.filter((r) => r.node.status === "running").length} running · ${tree().all.filter((r) => r.node.status === "completed").length} completed${props.state.complete() ? "" : " · partial"}`,
          width(),
        )}
      />
      <text> </text>
      <For each={tree().visible.map((entry) => entry.row.node.sessionId)}>
        {(id) => {
          const entry = () => entries().get(id);
          const row = () => entry()?.row;
          const indent = () =>
            " ".repeat(
              Math.min(entry()?.depth ?? 0, Math.floor(width() / 6)) * 2,
            );
          const prefix = () =>
            `${indent()}${entry()?.depth ? "└─ " : ""}${entry()?.hasChildren ? (collapsed().has(id) ? "▸ " : "▾ ") : ""}`;
          const nameWidth = () => Math.max(1, width() - cells(prefix()));
          return (
            <Show when={row()}>
              {(item) => (
                <box flexDirection="column" flexShrink={0}>
                  <box flexDirection="row" flexShrink={0}>
                    <Show when={prefix()}>
                      <text fg={colors().muted} onMouseDown={() => toggle(id)}>
                        {prefix()}
                      </text>
                    </Show>
                    <text
                      fg={rowColor(item())}
                      onMouseDown={() =>
                        props.context.ui.router.navigate({
                          type: "session",
                          sessionID: id,
                        })
                      }
                    >
                      <span style={{ fg: executionColor(item()) }}>
                        {agentHeading(item(), nameWidth()).slice(0, 1)}
                      </span>
                      <span>{agentHeading(item(), nameWidth()).slice(1)}</span>
                    </text>
                  </box>
                  <Index
                    each={agentLines(
                      item(),
                      Math.max(1, width() - cells(indent()) - 2),
                    )}
                  >
                    {(line) => (
                      <text fg={rowColor(item())}>
                        {indent()} {line()}
                      </text>
                    )}
                  </Index>
                  <text> </text>
                </box>
              )}
            </Show>
          );
        }}
      </For>
      <text fg={colors().muted} onMouseDown={toggleCompleted}>
        {clip(hideCompleted() ? "Show completed" : "Hide completed", width())}
      </text>
      <text fg={colors().muted} onMouseDown={toggleSort}>
        {clip(byPressure() ? "Sort: pressure" : "Sort: activity", width())}
      </text>
      <text fg={colors().muted} onMouseDown={toggleGroups}>
        {clip(collapsed().size ? "Expand groups" : "Collapse groups", width())}
      </text>
      <text> </text>
      <text fg={colors().muted}>{section("STATISTICS")}</text>
      <Lines
        lines={statistics(
          props.rows
            .filter((r) => r.node.sessionId === props.sessionID)
            .concat(tree().all),
          props.sessionID,
          props.state.complete(),
          width(),
        )}
      />
      <text
        fg={colors().muted}
        onMouseDown={() => props.context.ui.panel.open("context-guard.monitor")}
      >
        {clip("Open: /context-guard", width())}
      </text>
    </box>
  );
}
