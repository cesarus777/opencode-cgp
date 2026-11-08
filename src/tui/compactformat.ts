import {
  contextChart,
  type ContextSample,
  type ContextChartSegment,
} from "./contextchart.ts";
import type { GuardRow } from "../family.ts";
import { cells, clip, wrap, performanceLines } from "./format.ts";
import { tokens } from "./quantity.ts";
import { compactionLabel } from "./panelformat.ts";
import {
  contextHistoryLegend,
  freshnessLabel,
  measurementLabel,
  pressureLabel,
  thresholdDistance,
} from "./statusformat.ts";
export { tokens } from "./quantity.ts";

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
): MainSection[] {
  if (!row)
    return [{ tone: "base", lines: wrap("Loading session family...", width) }];
  const s = row.snapshot,
    m = s?.measurement;
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const measured = valid ? m?.tokens : undefined;
  const ratio =
    measured !== undefined &&
    s?.capacityTokens !== undefined &&
    s.capacityTokens > 0
      ? measured / s.capacityTokens
      : undefined;
  const lifecycle = compactionLabel(row);
  return [
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
      lines: columns(
        row.freshness === "stale" ? "Last measured" : "Context",
        `${m?.confidence === "approximate" && valid ? "~" : ""}${tokens(measured)} / ${tokens(s?.capacityTokens)}`,
        width,
      ),
    },
    { tone: "measurement", lines: [progress(ratio, width)] },
    { tone: "base", lines: performanceLines(row, width) },
    {
      tone: "pressure",
      lines: [
        ...wrap(thresholdDistance(row), width),
        ...(["near", "crossed"].includes(row.pressure) &&
        row.freshness === "fresh"
          ? wrap(pressureLabel(row), width)
          : []),
        ...(s?.capacityTokens !== undefined &&
        s.policy.triggerTokens !== undefined &&
        s.policy.triggerTokens > s.capacityTokens
          ? wrap("Threshold above capacity", width)
          : []),
      ],
    },
    {
      tone: "measurement",
      lines: wrap(measurementLabel(row, age), width),
    },
    {
      tone: "base",
      lines: [
        ...(lifecycle ? wrap(lifecycle, width) : []),
        ...(row.node.interrupted ? wrap("Interrupted", width) : []),
        ...(!s ? wrap("Guard: not monitored / unavailable", width) : []),
      ],
    },
  ];
}

export function historySections(
  row: GuardRow | undefined,
  width: number,
  age: number,
  samples: readonly ContextSample[],
  chartCapacity?: number,
): MainSection[] {
  const s = row?.snapshot,
    m = s?.measurement;
  return [
    ...contextChart(
      samples,
      s?.capacityTokens ?? chartCapacity,
      s?.policy.triggerTokens,
      width,
      m ? m.at + age : s ? s.observedAt + age : undefined,
    ).map(
      ({ line, threshold, segments }): MainSection => ({
        tone: threshold ? "threshold" : "measurement",
        lines: [line],
        ...(segments ? { segments } : {}),
      }),
    ),
    {
      tone: "measurement",
      lines: contextHistoryLegend.flatMap((line) => wrap(line, width)),
    },
    {
      tone: "pressure",
      lines: wrap(
        `Policy threshold ${tokens(s?.policy.triggerTokens)} · ${row?.freshness === "fresh" && row.pressureRatio !== undefined ? Math.round(row.pressureRatio * 100) : "?"}% of threshold`,
        width,
      ),
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
  return clip(
    `${statusSymbol[row.node.status]} ${row.node.agent ?? row.node.sessionId}`,
    width,
  );
}

export function agentLines(row: GuardRow, width: number) {
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const percent =
    valid && row.utilizationPercent !== undefined
      ? `${Math.round(row.utilizationPercent)}%`
      : "?%";
  const estimate =
    valid && row.snapshot?.measurement?.confidence === "approximate" ? "~" : "";
  const context = `${row.freshness === "stale" ? "Last measured" : "Context"} ${estimate}${percent}`;
  const pressure = pressureLabel(row);
  const full = `${context} · ${pressure}`;
  const short = `${row.freshness === "stale" ? "Last measured" : "Ctx"} ${estimate}${percent} · ${pressure === "Below threshold" ? "Threshold below" : pressure}`;
  const lifecycle = compactionLabel(row);
  return [
    progress(
      valid && row.utilizationPercent !== undefined
        ? row.utilizationPercent / 100
        : undefined,
      width,
    ),
    ...wrap(cells(full) <= width ? full : short, width),
    ...performanceLines(row, width),
    ...(row.node.status === "failed" || row.node.status === "unknown"
      ? wrap(row.node.status.toUpperCase(), width)
      : []),
    ...(row.freshness !== "fresh"
      ? wrap(freshnessLabel(row) ?? "", width)
      : []),
    ...(row.node.interrupted ? wrap("Interrupted", width) : []),
    ...(lifecycle ? wrap(lifecycle, width) : []),
  ];
}

// Only descendants of the selected session belong in its subagent section.
export function subagentTree(
  rows: readonly GuardRow[],
  sessionID: string,
  collapsed: ReadonlySet<string>,
  hideCompleted: boolean,
  byPressure: boolean,
  trustworthy = true,
) {
  const children = new Map<string, GuardRow[]>();
  const unique = new Map(rows.map((row) => [row.node.sessionId, row]));
  let complete = unique.size <= 2048;
  for (const row of [...unique.values()].slice(0, 2048)) {
    if (!row.node.parentId) continue;
    const list = children.get(row.node.parentId) ?? [];
    list.push(row);
    children.set(row.node.parentId, list);
  }
  type Branch = {
    row: GuardRow;
    children: Branch[];
    active: boolean;
    pressure: number;
    eligible: boolean;
    size: number;
    attention: boolean;
  };
  const seen = new Set([sessionID]);
  const all: GuardRow[] = [];
  const build = (
    id: string,
    depth: number,
  ): { branches: Branch[]; safe: boolean } => {
    if (depth > 64) {
      const safe = !children.get(id)?.length;
      if (!safe) complete = false;
      return { branches: [], safe };
    }
    let safe = true;
    const branches: Branch[] = [];
    for (const row of children.get(id) ?? []) {
      if (seen.has(row.node.sessionId)) {
        safe = false;
        complete = false;
        continue;
      }
      seen.add(row.node.sessionId);
      all.push(row);
      const nested = build(row.node.sessionId, depth + 1);
      const branchSafe = nested.safe && row.hidden === 0;
      safe &&= branchSafe;
      complete &&= branchSafe;
      const eligible =
        trustworthy &&
        unique.size <= 2048 &&
        branchSafe &&
        row.node.status === "completed" &&
        row.freshness === "fresh" &&
        row.pressure === "normal" &&
        row.snapshot?.compaction.phase === "idle" &&
        !row.node.interrupted &&
        nested.branches.every((b) => b.eligible);
      branches.push({
        row,
        children: nested.branches,
        eligible,
        active:
          row.node.status === "running" ||
          nested.branches.some((b) => b.active),
        pressure: Math.max(
          row.pressureRatio ?? -1,
          ...nested.branches.map((b) => b.pressure),
        ),
        size: 1 + nested.branches.reduce((sum, b) => sum + b.size, 0),
        attention: !eligible || nested.branches.some((b) => b.attention),
      });
    }
    return {
      safe,
      branches: branches.sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          (byPressure ? b.pressure - a.pressure : 0),
      ),
    };
  };
  const { branches } = build(sessionID, 0);
  const visible: {
    row: GuardRow;
    depth: number;
    hasChildren: boolean;
    hidden: number;
    attention: boolean;
  }[] = [];
  let grouped = 0;
  const count = (items: Branch[]) => {
    for (const item of items) {
      if (item.eligible) grouped++;
      count(item.children);
    }
  };
  count(branches);
  const visit = (items: Branch[], depth: number) => {
    for (const item of items) {
      if (hideCompleted && item.eligible) continue;
      const folded = collapsed.has(item.row.node.sessionId);
      visible.push({
        row: item.row,
        depth,
        hasChildren: !!item.children.length,
        hidden: folded ? item.size - 1 : 0,
        attention: folded && item.children.some((b) => b.attention),
      });
      if (!folded) visit(item.children, depth + 1);
    }
  };
  visit(branches, 0);
  return { all, visible, grouped, complete };
}

export function routeFamily(rows: readonly GuardRow[], sessionID: string) {
  const tree = subagentTree(rows, sessionID, new Set(), false, false, false);
  const root = rows.find((row) => row.node.sessionId === sessionID);
  return {
    rows: [...(root ? [root] : []), ...tree.all],
    complete: !!root && root.hidden === 0 && tree.complete,
  };
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
