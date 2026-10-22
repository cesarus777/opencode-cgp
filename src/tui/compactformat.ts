import {
  contextChart,
  type ContextSample,
  type ContextChartSegment,
} from "./contextchart.ts";
import type { GuardRow } from "../family.ts";
import { cells, clip, wrap, performanceLines } from "./format.ts";

export function tokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "?";
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function columns(left: string, right: string, width: number): string[] {
  if (cells(left) + cells(right) + 1 > width)
    return [...wrap(left, width), ...wrap(right, width)];
  return [left + " ".repeat(width - cells(left) - cells(right)) + right];
}

export function progress(ratio: number | undefined, width: number): string {
  const valid = ratio !== undefined && Number.isFinite(ratio) && ratio >= 0;
  const label = valid ? `${Math.round(ratio * 100)}%` : "?%";
  const size = Math.max(1, width - cells(label) - 1);
  const filled = valid ? Math.round(Math.min(1, ratio) * size) : 0;
  return clip(
    "█".repeat(filled) + "░".repeat(size - filled) + " " + label,
    width,
  );
}

export interface MainSection {
  readonly tone:
    | "base"
    | "execution"
    | "pressure"
    | "measurement"
    | "threshold";
  readonly lines: readonly string[];
  readonly segments?: readonly ContextChartSegment[];
}

export function mainSections(
  row: GuardRow | undefined,
  width: number,
  age: number,
  samples?: readonly ContextSample[],
  chartCapacity?: number,
): MainSection[] {
  if (!row)
    return [{ tone: "base", lines: wrap("Loading session family...", width) }];
  const s = row.snapshot,
    m = s?.measurement;
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const measured = valid ? m?.tokens : undefined;
  const ratio = (total: number | undefined) =>
    measured !== undefined && total !== undefined && total > 0
      ? measured / total
      : undefined;
  const remaining =
    measured !== undefined && s?.policy.triggerTokens !== undefined
      ? s.policy.triggerTokens - measured
      : undefined;
  return [
    ...(row.snapshot?.performance
      ? [{ tone: "base" as const, lines: performanceLines(row, width) }]
      : []),
    {
      tone: "execution",
      lines: columns(
        `${row.node.agent ?? s?.agent ?? "Main"} · ${row.node.model ?? s?.model ?? "?"}`,
        row.node.status.toUpperCase(),
        width,
      ),
    },
    {
      tone: "base",
      lines: [
        "",
        ...columns(
          "Context",
          `${tokens(measured)} / ${tokens(s?.capacityTokens)}`,
          width,
        ),
      ],
    },
    ...contextChart(
      samples ?? (m && valid ? [{ at: m.at, tokens: m.tokens }] : []),
      s?.capacityTokens ?? chartCapacity,
      s?.policy.triggerTokens,
      width,
      m
        ? m.at + age
        : s?.observedAt === undefined
          ? undefined
          : s.observedAt + age,
    ).map(
      ({ line, threshold, segments }): MainSection => ({
        tone: threshold ? "threshold" : "pressure",
        lines: [line],
        ...(segments ? { segments } : {}),
      }),
    ),
    ...(samples?.some((sample) => sample.held) || (m && age > 2500)
      ? [
          {
            tone: "measurement" as const,
            lines: wrap("┈ held · last known context", width),
          },
        ]
      : []),
    {
      tone: "base",
      lines: wrap(
        `${ratio(s?.capacityTokens) === undefined ? "?" : Math.round((ratio(s?.capacityTokens) ?? 0) * 100)}% used · recent samples → now`,
        width,
      ),
    },
    {
      tone: "base",
      lines: [
        "",
        ...columns(
          "Compact threshold",
          `${tokens(measured)} / ${tokens(s?.policy.triggerTokens)}`,
          width,
        ),
      ],
    },
    {
      tone: "pressure",
      lines: [
        ...wrap(
          `${ratio(s?.policy.triggerTokens) === undefined ? "?" : Math.round((ratio(s?.policy.triggerTokens) ?? 0) * 100)}% of threshold · ┄ trigger`,
          width,
        ),
        ...(s?.capacityTokens !== undefined &&
        s.policy.triggerTokens !== undefined &&
        s.policy.triggerTokens > s.capacityTokens
          ? wrap("Threshold above chart capacity", width)
          : []),
        ...wrap(
          remaining === undefined
            ? "Compaction distance unknown"
            : remaining < 0
              ? `${tokens(-remaining)} tokens over threshold`
              : `${tokens(remaining)} tokens until compaction`,
          width,
        ),
      ],
    },
    {
      tone: "measurement",
      lines: [
        "",
        ...wrap(
          `Measurement: ${m?.confidence ?? "unknown"}${m ? ` · ${Math.floor(Math.max(0, age) / 1000)}s ago` : ""}${row.freshness !== "fresh" ? ` · ${row.freshness.toUpperCase()}` : ""}`,
          width,
        ),
      ],
    },
    {
      tone: "base",
      lines: [
        ...(s && s.compaction.phase !== "idle"
          ? wrap(`Compact: ${s.compaction.phase}`, width)
          : []),
        ...(!s ? wrap("Guard: not monitored / unavailable", width) : []),
      ],
    },
  ];
}

export function mainLines(
  row: GuardRow | undefined,
  width: number,
  age: number,
) {
  return mainSections(row, width, age).flatMap((section) => section.lines);
}

export const statusSymbol = {
  running: "●",
  idle: "◌",
  unknown: "◌",
  completed: "✓",
  failed: "✕",
} as const;
export function agentHeading(row: GuardRow, width: number) {
  const name = `${statusSymbol[row.node.status]} ${row.node.agent ?? row.node.sessionId}`;
  const percent =
    row.utilizationPercent === undefined
      ? "?%"
      : `${Math.round(row.utilizationPercent)}%`;
  return cells(name) + cells(percent) + 1 <= width
    ? (columns(name, percent, width)[0] ?? "")
    : clip(name, width);
}

export function agentLines(row: GuardRow, width: number) {
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const measured = valid ? row.snapshot?.measurement?.tokens : undefined;
  const capacity = row.snapshot?.capacityTokens;
  const pressure =
    row.pressure === "crossed"
      ? "CRITICAL"
      : row.pressure === "near"
        ? "WARNING"
        : "";
  return [
    ...performanceLines(row, width),
    progress(
      measured !== undefined && capacity !== undefined && capacity > 0
        ? measured / capacity
        : undefined,
      width,
    ),
    ...wrap(
      `${tokens(measured)} / ${tokens(capacity)}${pressure ? ` · ${pressure}` : ""}`,
      width,
    ),
    ...wrap(
      `${row.node.status.toUpperCase()}${row.freshness !== "fresh" ? ` · ${row.freshness.toUpperCase()}` : ""}${row.node.interrupted ? " · interrupted" : ""}`,
      width,
    ),
    ...(row.snapshot && row.snapshot.compaction.phase !== "idle"
      ? wrap(`Compact: ${row.snapshot.compaction.phase}`, width)
      : []),
  ];
}

// Only descendants of the selected session belong in its subagent section.
export function subagentTree(
  rows: readonly GuardRow[],
  sessionID: string,
  collapsed: ReadonlySet<string>,
  hideCompleted: boolean,
  byPressure: boolean,
) {
  const children = new Map<string, GuardRow[]>();
  for (const row of rows) {
    if (!row.node.parentId || row.node.sessionId === sessionID) continue;
    const list = children.get(row.node.parentId) ?? [];
    list.push(row);
    children.set(row.node.parentId, list);
  }
  type Branch = {
    row: GuardRow;
    children: Branch[];
    active: boolean;
    pressure: number;
  };
  const seen = new Set([sessionID]);
  const all: GuardRow[] = [];
  const build = (id: string, depth: number): Branch[] => {
    if (depth > 64) return [];
    const branches: Branch[] = [];
    for (const row of children.get(id) ?? []) {
      if (seen.has(row.node.sessionId)) continue;
      seen.add(row.node.sessionId);
      all.push(row);
      const nested = build(row.node.sessionId, depth + 1);
      if (hideCompleted && row.node.status === "completed" && !nested.length)
        continue;
      branches.push({
        row,
        children: nested,
        active: row.node.status === "running" || nested.some((b) => b.active),
        pressure: Math.max(
          row.pressureRatio ?? -1,
          ...nested.map((b) => b.pressure),
        ),
      });
    }
    return branches.sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (byPressure ? b.pressure - a.pressure : 0),
    );
  };
  const branches = build(sessionID, 0);
  const visible: { row: GuardRow; depth: number; hasChildren: boolean }[] = [];
  const visit = (items: Branch[], depth: number) => {
    for (const item of items) {
      visible.push({
        row: item.row,
        depth,
        hasChildren: !!item.children.length,
      });
      if (!collapsed.has(item.row.node.sessionId))
        visit(item.children, depth + 1);
    }
  };
  visit(branches, 0);
  return { all, visible };
}

export function statistics(
  rows: readonly GuardRow[],
  sessionID: string,
  complete: boolean,
  width: number,
) {
  const sum = (value: (row: GuardRow) => number | undefined) => {
    const values = rows.map(value);
    return complete && values.length && values.every((n) => n !== undefined)
      ? values.reduce<number>((total, n) => total + (n ?? 0), 0)
      : undefined;
  };
  return [
    ...columns(
      "Compactions",
      tokens(sum((r) => r.snapshot?.compaction.count)),
      width,
    ),
    ...columns(
      "Active subagents",
      String(
        rows.filter(
          (r) => r.node.sessionId !== sessionID && r.node.status === "running",
        ).length,
      ),
      width,
    ),
    ...columns(
      "Family peaks (sum)",
      tokens(sum((r) => r.snapshot?.peakTokens)),
      width,
    ),
    ...wrap("Observed · separate windows", width),
  ];
}
