import type { GuardRow } from "../family.ts";
import type { MonitorHealth } from "../snapshot.ts";
import { cells, clip } from "./format.ts";
import { tokens } from "./compactformat.ts";

export const panelStatuses = {
  running: "RUNNING",
  idle: "IDLE",
  completed: "DONE",
  failed: "FAILED",
  unknown: "UNKNOWN",
} as const;

export function thresholdDistance(row: GuardRow | undefined): string {
  const delta = row?.triggerDeltaTokens;
  if (
    row?.freshness !== "fresh" ||
    row.pressure === "unknown" ||
    delta === undefined
  )
    return "pressure unknown";
  if (delta === 0)
    return row.pressure === "crossed"
      ? "threshold reached"
      : "at threshold (>)";
  if (delta < 0) return `${tokens(-delta)} over threshold`;
  return `${tokens(delta)} below${row.pressure === "near" ? " · near" : ""}`;
}

export function compactionLabel(row: GuardRow | undefined): string | undefined {
  const phase = row?.snapshot?.compaction.phase;
  if (!phase || phase === "idle") return undefined;
  return {
    requesting: "Compaction requested",
    accepted: "Accepted · waiting to start",
    running: "Compaction running",
    "awaiting-measurement": "Ended · checking context reduction",
    blocked: "Compaction blocked · automatic retry suppressed",
    uncertain: "Completion unconfirmed · automatic retry suppressed",
  }[phase];
}

export function panelStatus(health: MonitorHealth | undefined): string {
  switch (health?.enforcement) {
    case "observing":
      return "Observing · no Guard compaction";
    case "available":
      return "Automatic compaction enabled";
    case "disabled":
      return "Guard disabled";
    case "suspended":
      return "Guard suspended · reload required";
    default:
      return "Guard status unknown";
  }
}

export function panelSummary(
  row: GuardRow | undefined,
  width: number,
  age: number,
  compact = false,
): string[] {
  if (!row) return [clip("No sessions available · r refresh", width)];
  const snapshot = row.snapshot;
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const prefix = row.freshness === "stale" ? "Last measured" : "Context";
  const percent = `${row.utilizationPercent === undefined ? "?" : Math.round(row.utilizationPercent)}%`;
  const estimate =
    snapshot?.measurement?.confidence === "approximate" ? "~" : "";
  const identity = `${width < 28 ? ">" : "Selected:"} ${row.node.agent ?? row.node.sessionId}${row.current ? (width < 28 ? " *" : " (current)") : ""}`;
  const occupancy = compact
    ? `${prefix} ${estimate}${percent}`
    : `${prefix} ${estimate}${tokens(valid ? snapshot?.measurement?.tokens : undefined)}/${tokens(snapshot?.capacityTokens)} · ${percent}`;
  return [
    clip(identity, width),
    clip(occupancy, width),
    ...(!compact
      ? [
          clip(
            `Threshold ${tokens(snapshot?.policy.triggerTokens)} · ${thresholdDistance(row)}`,
            width,
          ),
          clip(
            `${row.node.model ?? snapshot?.model ?? "Model unknown"} · ${panelStatuses[row.node.status]}`,
            width,
          ),
          clip(
            `${snapshot?.measurement?.confidence ?? "Usage unknown"}${snapshot?.measurement ? ` · ${Math.floor(Math.max(0, age) / 1000)}s ago` : ""} · ${row.freshness}`,
            width,
          ),
        ]
      : []),
  ];
}

function tableLine(
  identity: string,
  status: string,
  context: string,
  threshold: string,
  width: number,
) {
  const pad = (value: string, size: number) => {
    const text = clip(value, size);
    return text + " ".repeat(Math.max(0, size - cells(text)));
  };
  return `${pad(identity, width - 43)} ${pad(status, 8)} ${pad(context, 7)} ${pad(threshold, 25)}`;
}

export function panelRowHeading(label: string, width: number): string {
  return width >= 72
    ? tableLine(label, "State", "Context", "Threshold", width)
    : clip(label, width);
}

export function panelRowLines(
  row: GuardRow,
  width: number,
  selected: boolean,
): string[] {
  const marker = `${selected ? ">" : " "}${row.current ? "*" : " "}`;
  const indent =
    " ".repeat(Math.min(row.depth, Math.floor(width / 24))) +
    (row.depth ? "└ " : "");
  const identity = `${marker} ${indent}${row.node.agent ?? row.node.sessionId}`;
  const percent = `${row.snapshot?.measurement?.confidence === "approximate" ? "~" : ""}${row.utilizationPercent === undefined ? "?" : Math.round(row.utilizationPercent)}%`;
  const status =
    width < 28
      ? {
          running: "RUN",
          idle: "IDLE",
          completed: "DONE",
          failed: "FAIL",
          unknown: "?",
        }[row.node.status]
      : panelStatuses[row.node.status];
  const distance = thresholdDistance(row);
  const pad = (value: string, size: number) => {
    const text = clip(value, size);
    return text + " ".repeat(Math.max(0, size - cells(text)));
  };
  const lines =
    width >= 72
      ? [tableLine(identity, status, percent, distance, width)]
      : [
          `${pad(identity, Math.max(1, width - status.length - 1))} ${status}`,
          clip(`${percent} context · ${distance}`, width),
        ];
  const exception = [
    row.freshness !== "fresh" ? row.freshness.toUpperCase() : "",
    compactionLabel(row),
    row.node.interrupted ? "interrupted" : "",
    row.hidden ? `+${row.hidden} hidden · Space expands` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (exception) lines.push(clip(exception, width));
  return lines.map((line) => clip(line, width));
}
