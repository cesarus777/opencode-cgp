import type { GuardRow } from "../family.ts";
import { clip } from "./format.ts";
import {
  compactionLabel,
  freshnessLabel,
  pressureLabel,
} from "./statusformat.ts";

export function nativeWorkspaceLayout(width: number, height: number) {
  const wide = width >= 110 && height >= 28;
  const treeWidth = wide ? Math.min(32, Math.floor(width * 0.27)) : 0;
  return {
    wide,
    treeWidth,
    contentWidth: wide ? width - treeWidth - 2 : width,
  };
}

export function contextOccupancy(row: GuardRow | undefined): string {
  const valid = row?.freshness === "fresh" || row?.freshness === "stale";
  return `${valid && row?.snapshot?.measurement?.confidence === "approximate" ? "~" : ""}${valid && row?.utilizationPercent !== undefined ? Math.round(row.utilizationPercent) : "?"}%`;
}

export function contextMeter(row: GuardRow | undefined, width: number) {
  const valid = row?.freshness === "fresh" || row?.freshness === "stale";
  const percent = valid ? row?.utilizationPercent : undefined;
  if (percent === undefined || !Number.isFinite(percent)) return undefined;
  const filled = Math.round(
    (Math.max(0, Math.min(100, percent)) / 100) * width,
  );
  const capacity = row?.snapshot?.capacityTokens;
  const trigger = row?.snapshot?.policy.triggerTokens;
  const marker =
    capacity !== undefined &&
    capacity > 0 &&
    trigger !== undefined &&
    trigger >= 0 &&
    trigger <= capacity
      ? Math.min(width - 1, Math.floor((trigger / capacity) * width))
      : -1;
  return Array.from({ length: width }, (_, i) => ({
    text: i === marker ? "┆" : i < filled ? "━" : "─",
    active: i < filled && i !== marker,
  }));
}

export function workspaceTreeLines(
  row: GuardRow,
  selected: boolean,
  position: number,
  width: number,
) {
  const indent = row.depth ? " ".repeat(Math.min(row.depth - 1, 3)) + "└ " : "";
  const lifecycle = compactionLabel(row, true);
  return [
    clip(
      `${selected ? ">" : " "}${row.current ? "*" : " "} #${position + 1} ${indent}${row.node.agent ?? "unknown agent"}`,
      width,
    ),
    clip(
      `${row.freshness === "stale" ? "Last " : ""}${contextOccupancy(row)} · ${row.node.status}${row.node.interrupted ? " · interrupted" : ""}`,
      width,
    ),
    clip(
      [
        freshnessLabel(row),
        lifecycle,
        row.hidden ? `+${row.hidden} hidden` : undefined,
        row.freshness === "fresh" && !lifecycle
          ? pressureLabel(row)
          : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      width,
    ),
  ];
}

/** Performance timing is independent of the context measurement's freshness. */
export function workspacePerformance(
  row: GuardRow | undefined,
  now: number | undefined,
  staleMs: number | undefined,
  live: boolean,
) {
  const p = row?.snapshot?.performance;
  const fresh =
    p !== undefined &&
    live &&
    now !== undefined &&
    staleMs !== undefined &&
    now >= p.at &&
    now - p.at <= staleMs;
  const rate = (value: number | undefined) =>
    value === undefined || !Number.isFinite(value) ? "?" : value.toFixed(1);
  return {
    fresh,
    live: fresh
      ? p.status === "waiting"
        ? "waiting"
        : p.liveTps === undefined
          ? "?"
          : `~${rate(p.liveTps)}`
      : "?",
    ttft:
      fresh && p.ttftMs !== undefined
        ? `~${(p.ttftMs / 1000).toFixed(2)}s`
        : "?",
    model: fresh ? rate(p.averageModelTps) : "?",
    session: fresh ? rate(p.averageSessionTps) : "?",
    status: !p ? "unavailable" : fresh ? p.status : "stale / unavailable",
    partial: p?.partial === true,
  };
}

/** Hide expired rates without changing the stored snapshot or context usage. */
export function performanceDisplayRow(
  row: GuardRow,
  now: number | undefined,
  staleMs: number | undefined,
  live: boolean,
): GuardRow {
  if (
    !row.snapshot?.performance ||
    workspacePerformance(row, now, staleMs, live).fresh
  )
    return row;
  const {
    liveTps: _live,
    ttftMs: _ttft,
    averageModelTps: _model,
    averageSessionTps: _session,
    latestRequestTps: _request,
    ...performance
  } = row.snapshot.performance;
  return { ...row, snapshot: { ...row.snapshot, performance } };
}
