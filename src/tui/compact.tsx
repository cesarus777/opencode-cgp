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
import { connectionLabel, monitorStatusLines } from "./statusformat.ts";
import {
  agentLines,
  agentHeading,
  mainSections,
  historySections,
  type MainSection,
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
  const [hideCompleted, setHideCompleted] = createSignal(true);
  const [showHistory, setShowHistory] = createSignal(false);
  const [byPressure, setByPressure] = createSignal(true);
  createEffect(() => {
    props.sessionID;
    setCollapsed(new Set<string>());
    setShowHistory(false);
  });
  const current = createMemo(() =>
    props.rows.find((r) => r.node.sessionId === props.sessionID),
  );
  const trace = createMemo(() => props.state.contextTrace(current()));
  const inventory = createMemo(() => props.state.inventoryStatus());
  const trustworthy = () =>
    inventory().complete &&
    !inventory().scanning &&
    !inventory().failed &&
    !inventory().damaged;
  const tree = createMemo(() =>
    subagentTree(
      props.rows,
      props.sessionID,
      collapsed(),
      hideCompleted(),
      byPressure(),
      trustworthy(),
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
  const toggleHistory = () => setShowHistory((value) => !value);
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
        id: "context-guard.history",
        title: "Show or hide sidebar context history",
        group: "Context Guard",
        palette: true,
        bind: false,
        run: toggleHistory,
      },
      {
        id: "context-guard.completed",
        title: "Show or hide completed subagent group",
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
  const notices = createMemo(() => [
    ...(!["2.0.29", "2.1.2"].includes(props.context.app.version)
      ? wrap(`Runtime ${props.context.app.version}: unverified`, width())
      : []),
    ...[
      connectionLabel(props.state.connection(), width() < 28),
      ...monitorStatusLines(
        props.state.connection(),
        props.state.health(),
        props.rows.some((row) => row.snapshot?.measurement !== undefined),
        width() < 28,
      ),
    ].flatMap((line) => wrap(line, width())),
  ]);
  function Sections(input: { sections: readonly MainSection[] }) {
    return (
      <Index each={input.sections}>
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
    );
  }
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
      <Sections
        sections={mainSections(
          current(),
          width(),
          props.state.age(props.sessionID),
        )}
      />
      <Index each={notices()}>
        {(line) => <text fg={colors().feedback.warning.base}>{line()}</text>}
      </Index>
      <text
        fg={colors().muted}
        onMouseDown={() => props.context.ui.panel.open("context-guard.monitor")}
      >
        {clip("Open: /context-guard", width())}
      </text>
      <text fg={colors().muted} onMouseDown={toggleHistory}>
        {clip(showHistory() ? "History: hide" : "History: show", width())}
      </text>
      <Show when={showHistory()}>
        <Sections
          sections={historySections(
            current(),
            width(),
            props.state.age(props.sessionID),
            trace().samples,
            trace().capacity,
          )}
        />
      </Show>
      <Lines
        lines={wrap(
          `SUBAGENTS (${tree().all.length}) · ${tree().all.filter((r) => r.node.status === "running").length} running${trustworthy() && tree().complete ? "" : " · partial"}`,
          width(),
        )}
      />
      <For each={tree().visible.map((entry) => entry.row.node.sessionId)}>
        {(id) => {
          const entry = () => entries().get(id);
          const row = () => entry()?.row;
          const indent = () =>
            " ".repeat(
              Math.min((entry()?.depth ?? 0) * 2, Math.max(0, width() - 16)),
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
                  <Show when={entry()?.hidden}>
                    <Lines
                      lines={wrap(
                        `${entry()?.hidden} hidden${entry()?.attention ? " · needs attention" : ""}`,
                        width(),
                      )}
                    />
                  </Show>
                </box>
              )}
            </Show>
          );
        }}
      </For>
      <Show when={tree().grouped > 0}>
        <text fg={colors().muted} onMouseDown={toggleCompleted}>
          {clip(
            `Completed (${tree().grouped}): ${hideCompleted() ? "show" : "hide"}`,
            width(),
          )}
        </text>
      </Show>
      <text fg={colors().muted} onMouseDown={toggleSort}>
        {clip(byPressure() ? "Sort: pressure" : "Sort: activity", width())}
      </text>
      <text fg={colors().muted} onMouseDown={toggleGroups}>
        {clip(collapsed().size ? "Expand groups" : "Collapse groups", width())}
      </text>
    </box>
  );
}
